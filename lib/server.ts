import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createClient } from "redis";
import {
  randomBytes,
  createHash,
  createHmac,
  timingSafeEqual,
  scryptSync,
} from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { cookies } from "next/headers";
import net from "node:net";

const globals = globalThis as unknown as {
  db: PrismaClient;
  redis: ReturnType<typeof createClient>;
};
export const db = (globals.db ||= new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
}));
export const redis = (globals.redis ||= createClient({
  url: process.env.REDIS_URL,
}));
redis.on("error", () => console.error("Redis connection error"));
let connecting: Promise<unknown> | undefined;
export async function cache() {
  if (!redis.isOpen)
    await (connecting ||= redis.connect().finally(() => {
      connecting = undefined;
    }));
  return redis;
}
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}
export async function limit(key: string, max = 120) {
  const r = await cache();
  const n = Number(
    await r.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
      { keys: ["limit:" + key], arguments: [] },
    ),
  );
  if (n > max) {
    await r.incr("stats:abuse");
    fail(429, "Too many requests. Please wait a minute.");
  }
}
export async function setting(key: string, fallback: number) {
  return (await db.setting.findUnique({ where: { key } }))?.value ?? fallback;
}
export const inboundReady = () =>
  process.env.INBOUND_ENABLED === "true" &&
  !!process.env.MAILGUN_SIGNING_KEY &&
  !/invalid$/.test(process.env.MAIL_DOMAIN || "localhost.invalid");
export function cleanHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "div",
      "span",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "h1",
      "h2",
      "h3",
      "table",
      "tr",
      "td",
      "th",
      "thead",
      "tbody",
      "hr",
    ],
    allowedAttributes: {},
    allowedSchemes: [],
    disallowedTagsMode: "discard",
  });
}
export async function session() {
  const token = (await cookies()).get("flashmail_session")?.value;
  if (!token) fail(401, "Create an inbox to continue.");
  const s = await db.session.findUnique({
    where: { tokenHash: hash(token) },
    include: { inbox: true },
  });
  if (
    !s ||
    s.expiresAt <= new Date() ||
    !s.inbox ||
    s.inbox.expiresAt <= new Date() ||
    s.inbox.status !== "active"
  )
    fail(401, "Your inbox has expired. Generate a new address.");
  return s as typeof s & { inbox: NonNullable<typeof s.inbox> };
}
export async function createInbox(regenerate = false) {
  const jar = await cookies();
  const old = jar.get("flashmail_session")?.value;
  const hours = await setting(
    "ttlHours",
    Number(process.env.INBOX_TTL_HOURS || 24),
  );
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + hours * 3600000);
  const emailAddress =
    randomBytes(9).toString("hex") +
    "@" +
    (process.env.MAIL_DOMAIN || "localhost.invalid");
  const result = await db.$transaction(async (tx) => {
    if (old) {
      const s = await tx.session.findUnique({
        where: { tokenHash: hash(old) },
        include: { inbox: true },
      });
      if (
        s &&
        s.expiresAt > new Date() &&
        s.inbox &&
        s.inbox.expiresAt > new Date() &&
        !regenerate
      )
        return { inbox: s.inbox, reuse: true };
      if (s) await tx.session.delete({ where: { id: s.id } });
    }
    const s = await tx.session.create({
      data: {
        tokenHash: hash(token),
        expiresAt,
        inbox: { create: { emailAddress, expiresAt } },
      },
      include: { inbox: true },
    });
    return { inbox: s.inbox!, reuse: false };
  });
  if (!result.reuse)
    jar.set("flashmail_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure:
        new URL(process.env.APP_URL || "http://localhost:3000").protocol ===
        "https:",
      path: "/",
      expires: expiresAt,
    });
  if (!result.reuse) await (await cache()).incr("stats:created");
  return result.inbox;
}
export async function scan(data: Buffer) {
  const host = process.env.CLAMAV_HOST;
  if (!host)
    fail(
      503,
      "Attachment scanner is not configured; delivery will be retried.",
    );
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({
      host,
      port: Number(process.env.CLAMAV_PORT || 3310),
    });
    let response = "";
    socket.setTimeout(15000, () =>
      socket.destroy(new Error("Scanner timeout")),
    );
    socket.on("error", reject);
    socket.on("connect", () => {
      socket.write(Buffer.from("zINSTREAM\0"));
      for (let i = 0; i < data.length; i += 65536) {
        const chunk = data.subarray(i, i + 65536);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (c) => (response += c.toString()));
    socket.on("end", () =>
      response.includes("stream: OK")
        ? resolve()
        : reject(new HttpError(422, "Attachment rejected by malware scanner")),
    );
  });
}
export function signature(
  timestamp: string,
  token: string,
  signature: string,
  key: string,
) {
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !/^[a-f0-9]{64}$/i.test(signature)
  )
    return false;
  const expected = createHmac("sha256", key)
    .update(timestamp + token)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
export async function cleanup() {
  const now = new Date();
  const count = await db.temporaryInbox.count({
    where: { expiresAt: { lte: now } },
  });
  await db.session.deleteMany({ where: { expiresAt: { lte: now } } });
  if (count) await (await cache()).incrBy("stats:expired", count);
  return count;
}
export function checkPassword(password: string) {
  const stored = process.env.ADMIN_PASSWORD_HASH;
  if (!stored) return false;
  const [salt, digest] = stored.split(":");
  if (!salt || !digest || !/^[a-f0-9]{128}$/.test(digest)) return false;
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(digest, "hex"),
  );
}
export async function admin() {
  const token = (await cookies()).get("flashmail_admin")?.value;
  if (!token || !(await (await cache()).get("admin:" + hash(token))))
    fail(401, "Administrator sign-in required.");
}
