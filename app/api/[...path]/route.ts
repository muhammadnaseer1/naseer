import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  db,
  cache,
  session,
  createInbox,
  limit,
  fail,
  HttpError,
  hash,
  cleanHtml,
  signature,
  scan,
  admin,
  checkPassword,
  inboundReady,
  setting,
} from "@/lib/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function bounded(req: NextRequest, max: number) {
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        fail(413, "Message exceeds size limit.");
      }
      chunks.push(value);
    }
  return Buffer.concat(chunks);
}
async function handler(req: NextRequest) {
  const path = req.nextUrl.pathname.replace("/api/", "");
  const method = req.method;
  try {
    if (path === "health") {
      await db.$queryRaw`SELECT 1`;
      await (await cache()).ping();
      return json({ status: "ok", receivingConfigured: inboundReady() });
    }
    if (method !== "GET" && path !== "webhooks/inbound-email") {
      if (
        req.headers.get("origin") !==
        new URL(process.env.APP_URL || "http://localhost:3000").origin
      )
        fail(403, "Origin verification failed.");
    }
    const ip =
      process.env.TRUST_PROXY === "true"
        ? req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown"
        : "shared";
    if (path === "webhooks/inbound-email") return await inbound(req);
    if (path === "admin/login" && method === "POST") {
      await limit("admin-login:" + ip, 5);
      const { password } = z
        .object({ password: z.string().max(512) })
        .parse(await req.json());
      if (!checkPassword(password))
        fail(401, "Invalid administrator credentials.");
      const token = randomBytes(32).toString("hex");
      await (await cache()).set("admin:" + hash(token), "1", { EX: 3600 });
      (await cookies()).set("flashmail_admin", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.APP_URL?.startsWith("https:"),
        path: "/",
        maxAge: 3600,
      });
      return json({ ok: true });
    }
    if (path.startsWith("admin/")) {
      await admin();
      await limit("admin:" + ip);
      if (path === "admin/logout" && method === "POST") {
        const token = (await cookies()).get("flashmail_admin")?.value;
        if (token) await (await cache()).del("admin:" + hash(token));
        (await cookies()).delete("flashmail_admin");
        return json({ ok: true });
      }
      if (path === "admin/stats" && method === "GET") {
        const r = await cache();
        const [
          active,
          stored,
          messages,
          storage,
          expired,
          errors,
          abuse,
          delivered,
          ttlHours,
          maxMessageBytes,
        ] = await Promise.all([
          db.temporaryInbox.count({
            where: { expiresAt: { gt: new Date() }, status: "active" },
          }),
          db.temporaryInbox.count(),
          db.emailMessage.count(),
          db.emailAttachment.aggregate({ _sum: { fileSize: true } }),
          r.get("stats:expired"),
          r.get("stats:webhookErrors"),
          r.get("stats:abuse"),
          r.get("stats:delivered"),
          setting("ttlHours", Number(process.env.INBOX_TTL_HOURS || 24)),
          setting(
            "maxMessageBytes",
            Number(process.env.MAX_MESSAGE_BYTES || 10485760),
          ),
        ]);
        const inboxes = await db.temporaryInbox.findMany({
          select: { id: true, emailAddress: true, expiresAt: true },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        return json({
          active,
          generated: Number((await r.get("stats:created")) || 0),
          messages,
          storage: storage._sum.fileSize || 0,
          expired: Number(expired || 0),
          errors: Number(errors || 0),
          abuse: Number(abuse || 0),
          delivered: Number(delivered || 0),
          ttlHours,
          maxMessageBytes,
          inboxes,
        });
      }
      if (path === "admin/settings" && method === "POST") {
        const data = z
          .object({
            ttlHours: z.number().int().min(1).max(168),
            maxMessageBytes: z.number().int().min(1024).max(10485760),
          })
          .parse(await req.json());
        await db.$transaction(
          Object.entries(data).map(([key, value]) =>
            db.setting.upsert({
              where: { key },
              create: { key, value },
              update: { value },
            }),
          ),
        );
        return json({ ok: true });
      }
      if (path.startsWith("admin/inboxes/") && method === "DELETE") {
        await db.session.deleteMany({
          where: { inbox: { id: path.split("/")[2] } },
        });
        return json({ ok: true });
      }
      fail(404, "Not found");
    }
    if (
      ["inbox/create", "inbox/regenerate"].includes(path) &&
      method === "POST"
    ) {
      await limit("create:" + ip, 30);
      const inbox = await createInbox(path.endsWith("regenerate"));
      return json({ inbox, receivingConfigured: inboundReady() }, 201);
    }
    const s = await session();
    await limit("session:" + s.id, 240);
    if (path === "inbox/current" && method === "GET")
      return json({ inbox: s.inbox, receivingConfigured: inboundReady() });
    if (path === "inbox/events" && method === "GET") {
      const sub = (await cache()).duplicate();
      await sub.connect();
      const encoder = new TextEncoder();
      let close = () => {};
      const stream = new ReadableStream({
        async start(controller) {
          let closed = false;
          let timer: ReturnType<typeof setInterval>;
          close = () => {
            if (closed) return;
            closed = true;
            clearInterval(timer);
            void sub.quit();
            try {
              controller.close();
            } catch {}
          };
          const emit = (v: string) => {
            if (!closed)
              try {
                controller.enqueue(encoder.encode(v));
              } catch {
                close();
              }
          };
          await sub.subscribe("inbox:" + s.inbox.id, () =>
            emit("event: message\ndata: {}\n\n"),
          );
          emit("event: ready\ndata: {}\n\n");
          timer = setInterval(() => {
            if (s.inbox.expiresAt <= new Date()) close();
            else emit(": heartbeat\n\n");
          }, 15000);
          req.signal.addEventListener("abort", close);
        },
        cancel() {
          close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }
    if (path === "inbox/messages") {
      if (method === "GET") {
        const messages = await db.emailMessage.findMany({
          where: { inboxId: s.inbox.id },
          select: {
            id: true,
            sender: true,
            subject: true,
            receivedAt: true,
            isRead: true,
            textBody: true,
          },
          orderBy: { receivedAt: "desc" },
          take: 200,
        });
        return json({
          messages: messages.map((m) => ({
            ...m,
            textBody: undefined,
            preview: m.textBody.slice(0, 160),
          })),
        });
      }
      if (method === "DELETE") {
        await db.emailMessage.deleteMany({ where: { inboxId: s.inbox.id } });
        await (await cache()).publish("inbox:" + s.inbox.id, "update");
        return json({ ok: true });
      }
    }
    if (path.startsWith("inbox/messages/")) {
      const parts = path.split("/");
      const m = await db.emailMessage.findFirst({
        where: { id: parts[2], inboxId: s.inbox.id },
        include: {
          attachments: {
            select: {
              id: true,
              filename: true,
              contentType: true,
              fileSize: true,
            },
          },
        },
      });
      if (!m) fail(404, "Message not found.");
      if (parts[3] === "attachments" && method === "GET") {
        const a = await db.emailAttachment.findFirst({
          where: { id: parts[4], messageId: m.id, scanStatus: "clean" },
        });
        if (!a) fail(404, "Attachment not found.");
        return new Response(new Uint8Array(a.data), {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition":
              "attachment; filename*=UTF-8''" + encodeURIComponent(a.filename),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (method === "GET") {
        await db.emailMessage.update({
          where: { id: m.id },
          data: { isRead: true },
        });
        return json({ ...m, isRead: true });
      }
      if (method === "DELETE") {
        await db.emailMessage.delete({ where: { id: m.id } });
        await (await cache()).publish("inbox:" + s.inbox.id, "update");
        return json({ ok: true });
      }
    }
    fail(404, "Not found.");
  } catch (e) {
    if (path === "webhooks/inbound-email")
      try {
        await (await cache()).incr("stats:webhookErrors");
      } catch {}
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof z.ZodError)
      return json({ error: "Invalid request." }, 400);
    console.error("Request failed", {
      path,
      type: e instanceof Error ? e.name : "unknown",
    });
    return json(
      { error: "Service temporarily unavailable. Please try again." },
      503,
    );
  }
}
async function inbound(req: NextRequest) {
  if (!inboundReady()) fail(503, "Inbound email is not configured.");
  const max = await setting(
    "maxMessageBytes",
    Number(process.env.MAX_MESSAGE_BYTES || 10485760),
  );
  const body = await bounded(req, max);
  const data = await new Request(req.url, {
    method: "POST",
    headers: { "Content-Type": req.headers.get("content-type") || "" },
    body: new Uint8Array(body),
  }).formData();
  const str = (key: string) => String(data.get(key) || "");
  if (
    !signature(
      str("timestamp"),
      str("token"),
      str("signature"),
      process.env.MAILGUN_SIGNING_KEY!,
    )
  )
    fail(401, "Invalid webhook signature.");
  const recipient = z.email().parse(str("recipient").toLowerCase());
  const inbox = await db.temporaryInbox.findUnique({
    where: { emailAddress: recipient },
  });
  if (!inbox || inbox.expiresAt <= new Date() || inbox.status !== "active")
    fail(406, "Unknown or expired recipient.");
  await limit("delivery:" + inbox.id, 60);
  const providerMessageId = str("Message-Id") || str("message-id");
  if (!providerMessageId || providerMessageId.length > 998)
    fail(400, "Message-Id is required.");
  if (
    await db.emailMessage.findUnique({
      where: {
        inboxId_providerMessageId: { inboxId: inbox.id, providerMessageId },
      },
    })
  )
    return json({ ok: true, duplicate: true });
  const r = await cache();
  const fresh = await r.set("webhook-token:" + hash(str("token")), "1", {
    NX: true,
    EX: 600,
  });
  if (!fresh) fail(409, "Webhook token already used.");
  try {
    const attachments = [];
    for (const [name, file] of data.entries()) {
      if (name.startsWith("attachment-") && file instanceof File) {
        if (
          attachments.length >= 10 ||
          file.size > Number(process.env.MAX_ATTACHMENT_BYTES || 5242880)
        )
          fail(413, "Attachment limit exceeded.");
        const bytes = Buffer.from(await file.arrayBuffer());
        await scan(bytes);
        attachments.push({
          filename: file.name.replace(/[\r\n/\\]/g, "_").slice(0, 200),
          contentType: file.type || "application/octet-stream",
          fileSize: file.size,
          data: bytes,
        });
      }
    }
    const sender = z
      .string()
      .max(998)
      .parse(str("sender") || str("from"));
    const subject = z.string().max(2000).parse(str("subject"));
    if (inbox.expiresAt <= new Date())
      fail(406, "Recipient expired during processing.");
    try {
      await db.emailMessage.create({
        data: {
          inboxId: inbox.id,
          providerMessageId,
          sender,
          recipient,
          subject,
          textBody: str("body-plain"),
          sanitizedHtmlBody: cleanHtml(str("body-html")),
          attachments: { create: attachments },
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002")
        return json({ ok: true, duplicate: true });
      throw e;
    }
    await r.incr("stats:delivered");
    await r.publish("inbox:" + inbox.id, "message");
    return json({ ok: true });
  } catch (e) {
    await r.del("webhook-token:" + hash(str("token")));
    throw e;
  }
}
export { handler as GET, handler as POST, handler as DELETE };
