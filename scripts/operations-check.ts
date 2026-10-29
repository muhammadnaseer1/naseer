import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cleanup, redis } from "../lib/server";
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Operations checks require a separate *_test database.");
const base = "http://localhost:3002";
async function request(
  path: string,
  method = "GET",
  cookie = "",
  data?: unknown,
) {
  return fetch(base + "/api/admin/" + path, {
    method,
    headers: { origin: base, cookie, "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
}
try {
  const bad = await request("login", "POST", "", { password: "wrong" });
  assert.equal(bad.status, 401);
  const login = await request("login", "POST", "", {
    password: "operations-test-only-password",
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await request("stats", "GET", cookie)).status, 200);
  assert.equal(
    (
      await request("settings", "POST", cookie, {
        ttlHours: 48,
        maxMessageBytes: 1048576,
      })
    ).status,
    200,
  );
  const stats = await (await request("stats", "GET", cookie)).json();
  assert.equal(stats.ttlHours, 48);
  assert.equal(
    (
      await request("settings", "POST", cookie, {
        ttlHours: -1,
        maxMessageBytes: 1,
      })
    ).status,
    400,
  );
  assert.equal((await request("logout", "POST", cookie)).status, 200);
  assert.equal((await request("stats", "GET", cookie)).status, 401);
  const s = await db.session.create({
    data: {
      tokenHash: randomBytes(32).toString("hex"),
      expiresAt: new Date(0),
      inbox: {
        create: {
          emailAddress: randomBytes(12).toString("hex") + "@test.example.org",
          expiresAt: new Date(0),
          messages: {
            create: {
              providerMessageId: randomBytes(8).toString("hex"),
              sender: "test@example.org",
              recipient: "test@example.org",
              subject: "Cleanup fixture",
              textBody: "",
              sanitizedHtmlBody: "",
              attachments: {
                create: {
                  filename: "fixture.txt",
                  contentType: "text/plain",
                  fileSize: 7,
                  data: Buffer.from("fixture"),
                },
              },
            },
          },
        },
      },
    },
    include: {
      inbox: { include: { messages: { include: { attachments: true } } } },
    },
  });
  const attachment = s.inbox!.messages[0].attachments[0];
  await cleanup();
  assert.equal(await db.session.findUnique({ where: { id: s.id } }), null);
  assert.equal(
    await db.emailAttachment.findUnique({ where: { id: attachment.id } }),
    null,
  );
  console.log(
    "Operations checks passed: admin login/auth/settings validation/logout; expired session/inbox/message/attachment cascade cleanup.",
  );
} finally {
  await db.setting.deleteMany();
  await db.$disconnect();
  if (redis.isOpen) await redis.quit();
}
