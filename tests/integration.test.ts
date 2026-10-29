import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const base = process.env.TEST_URL || "http://localhost:3001";
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const sessions: string[] = [];
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Integration tests require a separate *_test database.");
after(async () => {
  await db.session.deleteMany({
    where: {
      tokenHash: {
        in: sessions.map((c) =>
          createHash("sha256")
            .update(c.slice(c.indexOf("=") + 1))
            .digest("hex"),
        ),
      },
    },
  });
  await db.$disconnect();
});
async function call(
  path: string,
  method = "GET",
  cookie = "",
  body?: BodyInit,
) {
  return fetch(base + "/api/" + path, {
    method,
    headers: { origin: base, ...(cookie ? { cookie } : {}) },
    body,
  });
}
async function create() {
  const r = await call("inbox/create", "POST");
  assert.equal(r.status, 201);
  const cookie = r.headers.get("set-cookie")!.split(";")[0];
  sessions.push(cookie);
  return { cookie, ...(await r.json()) };
}
async function deliver(
  recipient: string,
  id: string,
  extra: Record<string, string> = {},
  valid = true,
) {
  const form = new FormData();
  const timestamp = String(Math.floor(Date.now() / 1000)),
    token = randomBytes(16).toString("hex");
  const fields = {
    timestamp,
    token,
    signature: valid
      ? createHmac("sha256", process.env.MAILGUN_SIGNING_KEY!)
          .update(timestamp + token)
          .digest("hex")
      : "0".repeat(64),
    recipient,
    "Message-Id": id,
    sender: "Alice <alice@example.org>",
    subject: "Hello, 世界",
    "body-plain": "Private message body",
    "body-html":
      '<script>alert(1)</script><img src="https://tracking.invalid/pixel"><a href="javascript:alert(1)">bad</a><b>Safe</b>',
    ...extra,
  };
  Object.entries(fields).forEach(([k, v]) => form.set(k, v));
  return call("webhooks/inbound-email", "POST", "", form);
}
test("anonymous access and CSRF are rejected", async () => {
  assert.equal((await call("inbox/messages")).status, 401);
  assert.equal(
    (
      await fetch(base + "/api/inbox/create", {
        method: "POST",
        headers: { origin: "https://evil.invalid" },
      })
    ).status,
    403,
  );
});
test("generation, browser restore, and concurrent independent users", async () => {
  const boxes = await Promise.all(Array.from({ length: 5 }, () => create()));
  assert.equal(new Set(boxes.map((b) => b.inbox.emailAddress)).size, 5);
  for (const b of boxes) {
    assert.equal(b.inbox.emailAddress.endsWith("@test.example.org"), true);
    assert.equal(JSON.stringify(b).includes("tokenHash"), false);
    const d = await (await call("inbox/current", "GET", b.cookie)).json();
    assert.equal(d.inbox.id, b.inbox.id);
  }
});
test("signed Unicode webhook, sanitization, idempotency, isolation, retrieval and deletion", async () => {
  const a = await create(),
    b = await create();
  const id = randomBytes(12).toString("hex");
  assert.equal(
    (await deliver(a.inbox.emailAddress, id, {}, false)).status,
    401,
  );
  assert.equal((await deliver(a.inbox.emailAddress, id)).status, 200);
  assert.equal((await deliver(a.inbox.emailAddress, id)).status, 200);
  const list = await (await call("inbox/messages", "GET", a.cookie)).json();
  assert.equal(list.messages.length, 1);
  const mid = list.messages[0].id;
  assert.equal(
    (await call("inbox/messages/" + mid, "GET", b.cookie)).status,
    404,
  );
  assert.equal(
    (await call("inbox/messages/" + mid, "DELETE", b.cookie)).status,
    404,
  );
  const m = await (await call("inbox/messages/" + mid, "GET", a.cookie)).json();
  assert.equal(m.subject, "Hello, 世界");
  assert.equal(m.isRead, true);
  assert.equal(m.sanitizedHtmlBody, "bad<b>Safe</b>");
  assert.equal(
    (await call("inbox/messages/" + mid, "DELETE", a.cookie)).status,
    200,
  );
  assert.equal(
    (await call("inbox/messages/" + mid, "GET", a.cookie)).status,
    404,
  );
});
test("unknown and expired inboxes reject delivery and restoration", async () => {
  assert.equal(
    (await deliver("unknown@test.example.org", "unknown")).status,
    406,
  );
  const a = await create();
  await db.temporaryInbox.update({
    where: { id: a.inbox.id },
    data: { expiresAt: new Date(0) },
  });
  assert.equal((await call("inbox/current", "GET", a.cookie)).status, 401);
  assert.equal((await deliver(a.inbox.emailAddress, "expired")).status, 406);
});
test("regeneration destroys old address and all messages", async () => {
  const a = await create();
  await deliver(a.inbox.emailAddress, "regen");
  const r = await call("inbox/regenerate", "POST", a.cookie);
  assert.equal(r.status, 201);
  sessions.push(r.headers.get("set-cookie")!.split(";")[0]);
  assert.equal((await call("inbox/current", "GET", a.cookie)).status, 401);
  assert.equal(await db.temporaryInbox.count({ where: { id: a.inbox.id } }), 0);
});
test("request rate limits return 429", async () => {
  const a = await create();
  let blocked = false;
  for (let i = 0; i < 245; i++) {
    const r = await call("inbox/current", "GET", a.cookie);
    if (r.status === 429) {
      blocked = true;
      break;
    }
    assert.equal(r.status, 200);
  }
  assert.equal(blocked, true);
});
test("SSE publishes an update on signed incoming delivery", async () => {
  const a = await create();
  const controller = new AbortController();
  const response = await fetch(base + "/api/inbox/events", {
    headers: { cookie: a.cookie },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") || "",
    /text\/event-stream/,
  );
  const reader = response.body!.getReader();
  const decode = new TextDecoder();
  let value = "";
  try {
    value += decode.decode((await reader.read()).value);
    assert.match(value, /event: ready/);
    await deliver(
      a.inbox.emailAddress,
      "sse-" + randomBytes(5).toString("hex"),
    );
    const next = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("SSE update timed out")), 5000),
      ),
    ]);
    value += decode.decode(next.value);
    assert.match(value, /event: message/);
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
});
test("admin endpoints deny anonymous access", async () => {
  assert.equal((await call("admin/stats")).status, 401);
  assert.equal(
    (
      await call(
        "admin/settings",
        "POST",
        "",
        JSON.stringify({ ttlHours: 48, maxMessageBytes: 1024 }),
      )
    ).status,
    401,
  );
});
test("attachments fail closed without an available scanner", async () => {
  const a = await create();
  const timestamp = String(Math.floor(Date.now() / 1000)),
    token = randomBytes(16).toString("hex");
  const form = new FormData();
  Object.entries({
    timestamp,
    token,
    signature: createHmac("sha256", process.env.MAILGUN_SIGNING_KEY!)
      .update(timestamp + token)
      .digest("hex"),
    recipient: a.inbox.emailAddress,
    "Message-Id": "attachment-test",
    sender: "alice@example.org",
    subject: "Attachment",
  }).forEach(([k, v]) => form.set(k, v));
  form.set(
    "attachment-1",
    new File(["benign content"], "notes.txt", { type: "text/plain" }),
  );
  const r = await call("webhooks/inbound-email", "POST", "", form);
  assert.equal(r.status, 503);
  assert.equal(
    (await (await call("inbox/messages", "GET", a.cookie)).json()).messages
      .length,
    0,
  );
});
