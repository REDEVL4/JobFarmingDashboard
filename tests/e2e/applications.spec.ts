import { test, expect } from "@playwright/test";

test.describe("Applications Management & Filtering", () => {
  test("supports multi-status selection and search-as-you-type", async ({ page }) => {
    await page.goto("/applications");

    await expect(page.locator("h1")).toContainText("Applications Tracker");

    // Click "Interviewing" filter tab
    await page.click("button:has-text('Interviewing')");
    await expect(page).toHaveURL(/.*status=interviewing/);

    // Search for "Microsoft"
    const searchInput = page.getByPlaceholder("Search by company, role title, or notes...");
    await searchInput.fill("Microsoft");

    // Expect Microsoft to be visible and Snowflake to be filtered out
    await expect(page.getByText("Microsoft").first()).toBeVisible();
    await expect(page.getByText("Snowflake")).not.toBeVisible();

    // Click on Microsoft row to open detail drawer
    await page.click("tr:has-text('Microsoft')");

    // Expect drawer to open with chronological activity timeline
    await expect(page.getByText("Chronological Activity Timeline")).toBeVisible();
    await expect(page.getByText("Software Engineer II (EngOps)")).toBeVisible();

    // Close panel
    await page.click("button:has-text('Close Panel')");
    await expect(page.getByText("Chronological Activity Timeline")).not.toBeVisible();
  });
});

