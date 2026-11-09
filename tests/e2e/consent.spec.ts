import { test, expect } from "@playwright/test";

test.describe("OAuth 2.1 Consent Protocol", () => {
  test("renders owner verification, client metadata, and disabled approval", async ({ page }) => {
    await page.goto("/oauth/consent?client_id=grok-agent&redirect_uri=https://grok.com/connectors-oauth-exchange-code/&scope=openid%20profile%20email");

    // Header & PKCE banner
    await expect(page.getByText("OAuth 2.1 Authorization Consent")).toBeVisible();
    await expect(page.getByText("PKCE Enforced (S256)")).toBeVisible();

    // Owner UUID verification
    await expect(page.getByText("f2729195-5445-4272-ab85-cac5b03b0967")).toBeVisible();

    // Trust policy validation
    await expect(page.getByText("Exact Whitelisted Callback URI")).toBeVisible();

    // Approval must be disabled per production security policy
    const approveBtn = page.getByRole("button", { name: "Approval Unavailable (Config Required)" });
    const denyBtn = page.getByRole("button", { name: "Deny Access" });

    await expect(approveBtn).toBeVisible();
    await expect(approveBtn).toBeDisabled();
    await expect(denyBtn).toBeVisible();
  });
});
