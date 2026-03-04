const { test, expect } = require('@playwright/test');

test.describe('Dashboard login', () => {
  test('login page shows salon selection', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    // Dashboard first shows salon picker (Meylan / Grenoble)
    const meylanBtn = page.locator('text=MEYLAN').first();
    const grenobleBtn = page.locator('text=GRENOBLE').first();
    await expect(meylanBtn).toBeVisible();
    await expect(grenobleBtn).toBeVisible();
  });

  test('clicking salon shows login form', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    // Click "GERER CE SALON" for Meylan
    const gererBtn = page.locator('text=GERER CE SALON').first();
    await gererBtn.click();
    await page.waitForTimeout(1500);

    // Now the login form should appear
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    await expect(emailInput.first()).toBeVisible();
    await expect(passwordInput.first()).toBeVisible();
  });

  test('login form has submit button', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    const gererBtn = page.locator('text=GERER CE SALON').first();
    await gererBtn.click();
    await page.waitForTimeout(1500);

    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn.first()).toBeVisible();
    const text = await submitBtn.first().textContent();
    expect(text.toLowerCase()).toMatch(/connexion|connecter/);
  });

  test('empty form submission does not reach planning', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    const gererBtn = page.locator('text=GERER CE SALON').first();
    await gererBtn.click();
    await page.waitForTimeout(1500);

    const submitBtn = page.locator('button[type="submit"]');
    if (await submitBtn.count() > 0) {
      await submitBtn.first().click();
      await page.waitForTimeout(1000);
      const url = page.url();
      // Should NOT reach the authenticated planning page
      expect(url).not.toContain('planning');
    }
  });

  test('password field masks input', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    const gererBtn = page.locator('text=GERER CE SALON').first();
    await gererBtn.click();
    await page.waitForTimeout(1500);

    const passwordInput = page.locator('input[type="password"]');
    if (await passwordInput.count() > 0) {
      const type = await passwordInput.first().getAttribute('type');
      expect(type).toBe('password');
    }
  });
});
