import { chromium } from "playwright";
import fs from "fs";
import path from "path";

async function main() {
  const screenshotsDir = path.resolve(process.cwd(), "screenshots");
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  console.log("Capturing Login screen...");
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(screenshotsDir, "01-owner-login-fail-closed.png"), fullPage: true });

  console.log("Capturing OAuth Consent screen...");
  await page.goto("http://localhost:3000/oauth/consent?client_id=grok-agent&redirect_uri=https://grok.com/connectors-oauth-exchange-code/&scope=openid%20profile%20email", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(screenshotsDir, "02-oauth-consent-live-locked.png"), fullPage: true });

  await browser.close();
  console.log("Screenshots captured successfully in ./screenshots/");
}

main().catch(console.error);

