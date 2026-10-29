import "dotenv/config";
import { cleanup, db, redis } from "../lib/server";
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
while (!stopping) {
  try {
    await cleanup();
  } catch {
    console.error("Cleanup failed; retrying in 60 seconds");
  }
  await new Promise((r) => setTimeout(r, 60000));
}
await db.$disconnect();
if (redis.isOpen) await redis.quit();
