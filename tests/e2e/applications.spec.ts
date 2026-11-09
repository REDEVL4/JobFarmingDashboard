import { test, expect } from "@playwright/test";

test.describe("Applications Tracker - Route Protection & Boundary", () => {
  test("unauthenticated access redirects to /login", async ({ page }) => {
    await page.goto("/applications");
    await expect(page).toHaveURL(/.*\/login/);

    // Verify login page rendered with owner guard
    await expect(page.getByText("Owner Access Verification")).toBeVisible();
    await expect(page.getByText("f2729195")).toBeVisible();
  });
});
