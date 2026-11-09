import { test, expect } from "@playwright/test";

test.describe("Executive Dashboard", () => {
  test("renders KPI cards and core navigation", async ({ page }) => {
    await page.goto("/");

    // Verify main header
    await expect(page.locator("h1")).toContainText("Executive Command Center");

    // Verify presence of all key KPI titles
    await expect(page.getByText("Total Applications")).toBeVisible();
    await expect(page.getByText("Submitted")).toBeVisible();
    await expect(page.getByText("Interviews")).toBeVisible();
    await expect(page.getByText("Offers Received")).toBeVisible();
    await expect(page.getByText("Employer Response Rate")).toBeVisible();

    // Verify safety policy banner
    await expect(page.getByText("Production Safety Policy Active")).toBeVisible();
  });

  test("clicking a KPI card redirects to filtered applications", async ({ page }) => {
    await page.goto("/");
    await page.click("text=Interviews");
    await expect(page).toHaveURL(/.*applications\?status=interviewing/);
  });
});

