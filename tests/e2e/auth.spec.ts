import { test, expect } from "@playwright/test";

test.describe("Authentication Security & Route Protection", () => {
  test("unauthenticated visits to protected routes redirect to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/.*\/login/);

    await page.goto("/applications");
    await expect(page).toHaveURL(/.*\/login/);

    await page.goto("/monitoring");
    await expect(page).toHaveURL(/.*\/login/);
  });

  test("login page renders owner verification and fails closed on invalid credentials", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByText("Owner Access Verification")).toBeVisible();
    await expect(page.getByText("f2729195")).toBeVisible();

    // Fill invalid credentials
    await page.fill('input[type="password"]', "wrong_password_123");
    await page.click('button[type="submit"]');

    // Must show authentication error and remain on /login
    await expect(page.getByText(/Authentication failed/i)).toBeVisible();
    await expect(page).toHaveURL(/.*\/login/);
  });
});

