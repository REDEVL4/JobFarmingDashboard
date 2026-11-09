import { test } from "@playwright/test";
import path from "path";
import fs from "fs";

test.describe("Visual Evidence Capture", () => {
  test("captures screenshots of login and oauth consent", async ({ page }) => {
    const screenshotsDir = path.resolve(process.cwd(), "screenshots");
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    // 1. Owner Login
    await page.goto("/login");
    await page.screenshot({ path: path.join(screenshotsDir, "01-owner-login-fail-closed.png"), fullPage: true });

    // 2. OAuth Consent (Disabled simulation & locked grant)
    await page.goto("/oauth/consent?client_id=grok-agent&redirect_uri=https://grok.com/connectors-oauth-exchange-code/&scope=openid%20profile%20email");
    await page.screenshot({ path: path.join(screenshotsDir, "02-oauth-consent-live-locked.png"), fullPage: true });
  });
});

