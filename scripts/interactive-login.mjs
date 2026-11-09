import { chromium } from "playwright";
import fs from "fs";
import path from "path";

async function main() {
  const authDir = path.resolve(process.cwd(), "playwright/.auth");
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const authFile = path.join(authDir, "owner.json");

  console.log("Launching interactive browser for Owner Authentication...");
  console.log("Complete your login in the browser window.");
  console.log("The session state will be saved securely to playwright/.auth/owner.json (Git-ignored).");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("http://localhost:3000/login");

  try {
    // Wait for the owner to sign in and reach the dashboard
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/applications", {
      timeout: 180000, // 3 minutes
    });

    console.log("Sign-in detected! Saving session state...");
    await context.storageState({ path: authFile });
    console.log("Session saved successfully to playwright/.auth/owner.json!");
  } catch (err) {
    console.warn("Login wait timed out or was closed:", err.message);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);

