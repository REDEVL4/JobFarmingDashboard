import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE_URL = "https://job-farming-dashboard.vercel.app";
const SCREENSHOT_DIR = path.resolve(process.cwd(), "screenshots/deployment");

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function verifyDeployment() {
  console.log(`Starting Live Vercel Deployment Verification for: ${BASE_URL}\n`);

  const results = {
    url: BASE_URL,
    timestamp: new Date().toISOString(),
    healthCheck: {},
    routeProtection: [],
    loginPage: {},
    oauthPage: {},
    mobileResponsiveness: {},
    consoleErrors: [],
    summary: { passed: 0, failed: 0 },
  };

  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Health check & Headers
    console.log("Checking deployment health & HTTP headers...");
    const headRes = await fetch(BASE_URL + "/login");
    results.healthCheck = {
      status: headRes.status,
      ok: headRes.ok,
      server: headRes.headers.get("server") || "Vercel",
      xVercelId: headRes.headers.get("x-vercel-id"),
      cacheControl: headRes.headers.get("cache-control"),
    };
    if (headRes.ok) results.summary.passed++;
    else results.summary.failed++;

    // 2. Protected Routes Boundary (Anonymous visits MUST redirect to /login)
    console.log("Testing fail-closed route boundaries on all protected endpoints...");
    const protectedRoutes = [
      "/",
      "/applications",
      "/monitoring",
      "/outreach",
      "/diagnostics",
      "/api/documents/test-uuid",
    ];

    for (const route of protectedRoutes) {
      const res = await fetch(BASE_URL + route, { redirect: "manual" });
      const location = res.headers.get("location");
      const isRedirect = res.status === 307 || res.status === 302 || res.status === 308;
      const redirectToLogin = location && location.includes("/login");

      const passed = isRedirect && redirectToLogin;
      if (passed) results.summary.passed++;
      else results.summary.failed++;

      results.routeProtection.push({
        route,
        status: res.status,
        location,
        failClosed: passed,
      });
      console.log(`  ${route}: ${res.status} -> ${location} (${passed ? "PASS" : "FAIL"})`);
    }

    // 3. Desktop Browser Testing (Login & OAuth pages)
    console.log("\nTesting Desktop Viewport (1280x800)...");
    const desktopContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const desktopPage = await desktopContext.newPage();

    desktopPage.on("console", (msg) => {
      if (msg.type() === "error") {
        results.consoleErrors.push({ page: desktopPage.url(), text: msg.text() });
      }
    });

    // Visit /login
    await desktopPage.goto(BASE_URL + "/login", { waitUntil: "networkidle" });
    const loginTitle = await desktopPage.title();
    const hasOwnerEmail = await desktopPage.getByText("govardhanreddy.vys7@gmail.com").isVisible();
    const hasOwnerBadge = await desktopPage.getByText("Owner Access Only").isVisible();
    const hasAuthShield = await desktopPage.getByText("Authorized Principal Access").isVisible();

    // Verify invalid login fails closed
    await desktopPage.fill('input[type="email"]', "unauthorized@example.com");
    await desktopPage.fill('input[type="password"]', "wrongpassword123");
    await desktopPage.click('button[type="submit"]');
    await desktopPage.waitForTimeout(2000);

    const stayedOnLogin = desktopPage.url().includes("/login");
    const hasErrorAlert = await desktopPage.locator(".text-rose-600, .bg-destructive, [role='alert'], .text-destructive, .border-destructive").first().isVisible().catch(() => false);

    results.loginPage = {
      title: loginTitle,
      ownerEmailVisible: hasOwnerEmail,
      ownerBadgeVisible: hasOwnerBadge,
      authShieldVisible: hasAuthShield,
      failedClosedOnInvalidAuth: stayedOnLogin,
    };
    if (hasOwnerEmail && hasOwnerBadge && stayedOnLogin) results.summary.passed++;
    else results.summary.failed++;

    await desktopPage.screenshot({
      path: path.join(SCREENSHOT_DIR, "vercel-01-login-desktop.png"),
      fullPage: true,
    });
    console.log("  Saved screenshot: vercel-01-login-desktop.png");

    // Visit /oauth/consent
    await desktopPage.goto(
      BASE_URL +
        "/oauth/consent?client_id=test-client&client_name=ChatGPT+Job+Farming+GPT&redirect_uri=https://chatgpt.com/aip/callback&scope=openid+profile+email",
      { waitUntil: "networkidle" }
    );
    const hasOAuthHeader = await desktopPage.getByText("Authorize Job Farming Access").isVisible();
    const hasApprovalDisabled = await desktopPage.locator("button:disabled:has-text('Approve')").first().isVisible().catch(() => false);
    const hasSecurityWarning = await desktopPage.getByText("Approval Disabled").isVisible();

    results.oauthPage = {
      headerVisible: hasOAuthHeader,
      approvalLocked: hasApprovalDisabled,
      securityWarningVisible: hasSecurityWarning,
    };
    if (hasOAuthHeader && hasApprovalDisabled) results.summary.passed++;
    else results.summary.failed++;

    await desktopPage.screenshot({
      path: path.join(SCREENSHOT_DIR, "vercel-02-oauth-consent-desktop.png"),
      fullPage: true,
    });
    console.log("  Saved screenshot: vercel-02-oauth-consent-desktop.png");
    await desktopContext.close();

    // 4. Mobile Viewport Testing (375x667)
    console.log("\nTesting Mobile Viewport (375x667)...");
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 667 },
      isMobile: true,
    });
    const mobilePage = await mobileContext.newPage();

    await mobilePage.goto(BASE_URL + "/login", { waitUntil: "networkidle" });
    const mobileOwnerVisible = await mobilePage.getByText("Owner Access Only").isVisible();

    await mobilePage.screenshot({
      path: path.join(SCREENSHOT_DIR, "vercel-03-login-mobile.png"),
      fullPage: true,
    });
    console.log("  Saved screenshot: vercel-03-login-mobile.png");

    await mobilePage.goto(
      BASE_URL +
        "/oauth/consent?client_id=test-client&client_name=ChatGPT+Job+Farming+GPT&redirect_uri=https://chatgpt.com/aip/callback&scope=openid+profile+email",
      { waitUntil: "networkidle" }
    );
    const mobileOAuthVisible = await mobilePage.getByText("Authorize Job Farming Access").isVisible();

    await mobilePage.screenshot({
      path: path.join(SCREENSHOT_DIR, "vercel-04-oauth-mobile.png"),
      fullPage: true,
    });
    console.log("  Saved screenshot: vercel-04-oauth-mobile.png");

    results.mobileResponsiveness = {
      loginResponsive: mobileOwnerVisible,
      oauthResponsive: mobileOAuthVisible,
    };
    if (mobileOwnerVisible && mobileOAuthVisible) results.summary.passed++;
    else results.summary.failed++;

    await mobileContext.close();
  } catch (err) {
    console.error("Verification error:", err);
    results.error = err.message;
  } finally {
    await browser.close();
  }

  console.log("\nVerification Results Summary:");
  console.log(`Passed Checks: ${results.summary.passed}`);
  console.log(`Failed Checks: ${results.summary.failed}`);
  console.log(`Console Errors: ${results.consoleErrors.length}`);

  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, "verification-summary.json"),
    JSON.stringify(results, null, 2)
  );

  return results;
}

verifyDeployment().catch(console.error);

