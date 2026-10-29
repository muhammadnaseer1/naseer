import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:3000");
  await page.getByText("Live updates on", { exact: true }).waitFor();
  const address = await page.locator(".address-text").innerText();
  assert.match(address, /@localhost.invalid$/);
  await page.getByRole("button", { name: "Copy address", exact: true }).click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    address,
  );
  await page.getByRole("button", { name: "Toggle dark mode" }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.getByRole("button", { name: "Toggle dark mode" }).click();
  await page.reload();
  await page.getByText("Live updates on", { exact: true }).waitFor();
  assert.equal(await page.locator(".address-text").innerText(), address);
  await page.screenshot({
    path: "artifacts/flashmail-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "New address", exact: true }).click();
  await page.waitForFunction(
    (old) => document.querySelector(".address-text")?.textContent !== old,
    address,
  );
  assert.notEqual(await page.locator(".address-text").innerText(), address);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/flashmail-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "How it works", exact: true }).click();
  const isolated = await browser.newContext();
  const other = await isolated.newPage();
  await other.goto("http://localhost:3000");
  await other.getByText("Live updates on", { exact: true }).waitFor();
  assert.notEqual(
    await other.locator(".address-text").innerText(),
    await page.locator(".address-text").innerText(),
  );
  await isolated.close();
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: desktop/mobile, clipboard, theme, restoration, regeneration, separate sessions, no overflow or JS errors.",
  );
  await context.close();
} finally {
  await browser.close();
}
