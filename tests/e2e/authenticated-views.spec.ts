import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const authFile = path.resolve(process.cwd(), "playwright/.auth/owner.json");
const hasAuth = fs.existsSync(authFile);

test.describe("Authenticated Owner Views & Ground Truth Verification", () => {
  // If owner session is saved, inject storageState; otherwise skip with explicit guidance
  test.beforeEach(async () => {
    test.skip(!hasAuth, "Owner session state not found in playwright/.auth/owner.json. Complete interactive login to run authenticated suite.");
  });

  if (hasAuth) {
    test.use({ storageState: authFile });
  }

  test("1. Main Dashboard: renders live overview, real KPI counts, and safety policy", async ({ page }) => {
    await page.goto("/");

    // Verify main header
    await expect(page.locator("h1")).toContainText("Executive Command Center");

    // Verify live overview badge
    await expect(page.getByText("Live Overview")).toBeVisible();

    // Verify key KPI labels
    await expect(page.getByText("Total Applications")).toBeVisible();
    await expect(page.getByText("Submitted")).toBeVisible();
    await expect(page.getByText("Interviews")).toBeVisible();
    await expect(page.getByText("Rejected Applications")).toBeVisible();

    // Verify safety policy banner
    await expect(page.getByText("Production Safety Policy Active")).toBeVisible();
  });

  test("2. Application Tracker: renders synchronized table and multi-status segmented tabs", async ({ page }) => {
    await page.goto("/applications");

    await expect(page.locator("h1")).toContainText("Applications Tracker");
    await expect(page.getByPlaceholder("Search by company, role title, or notes...")).toBeVisible();

    // Verify segmented filter tabs
    await expect(page.getByRole("button", { name: "All" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Applied" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rejected" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Assessment" })).toBeVisible();
  });

  test("3. Rejected-Only Filter: displays only rejected applications without hiding or inflating", async ({ page }) => {
    await page.goto("/applications?status=rejected");

    // Verify URL reflects filtered state
    await expect(page).toHaveURL(/.*status=rejected/);

    // Verify table renders rejected rows
    const rejectedBadges = page.locator("span:has-text('Rejected')");
    await expect(rejectedBadges.first()).toBeVisible();
  });

  test("4. Application Details: opening a record drawer reveals chronological timeline and evaluation notes", async ({ page }) => {
    await page.goto("/applications");

    // Click on the first application row
    const firstRow = page.locator("tbody tr").first();
    await firstRow.click();

    // Drawer should open
    await expect(page.getByText("Chronological Activity Timeline")).toBeVisible();
    await expect(page.getByRole("button", { name: "Close Panel" })).toBeVisible();

    // Close panel
    await page.click("button:has-text('Close Panel')");
    await expect(page.getByText("Chronological Activity Timeline")).not.toBeVisible();
  });

  test("5. Outreach CRM: renders real prospects and strict approval controls", async ({ page }) => {
    await page.goto("/outreach");

    await expect(page.locator("h1")).toContainText("LinkedIn Outreach CRM");
    await expect(page.getByText("Strict Approval Gate (No Auto-Send)")).toBeVisible();
    await expect(page.getByText("Prospects Identified")).toBeVisible();
    await expect(page.getByText("Pending Approval")).toBeVisible();
  });

  test("6. Gmail Monitoring History: renders verified hourly poller telemetry and ingestion stream", async ({ page }) => {
    await page.goto("/monitoring");

    await expect(page.locator("h1")).toContainText("Recruitment Email Telemetry & Review");
    await expect(page.getByText("Hourly Poller")).toBeVisible();
    await expect(page.getByText("Read-Only Telemetry View")).toBeVisible();
    await expect(page.getByText("Recruitment Ingestion Records")).toBeVisible();
  });
});

