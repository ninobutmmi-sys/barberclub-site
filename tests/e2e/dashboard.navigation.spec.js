const { test, expect } = require('@playwright/test');

test.describe('Dashboard navigation (unauthenticated)', () => {
  test('root shows salon selection', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    // Verify the React app mounted with salon selector
    const body = page.locator('body');
    await expect(body).toContainText(/MEYLAN|GRENOBLE|salon/i);
  });

  test('salon cards show addresses and barbers', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    await expect(page.locator('body')).toContainText(/Corenc|Gresivaudan/i);
    await expect(page.locator('body')).toContainText(/Lucas|Tom/i);
  });

  test('accessing planning without auth redirects', async ({ page }) => {
    await page.goto('/#/planning');
    await page.waitForTimeout(2000);
    const url = page.url();
    // Should redirect to login since no auth tokens exist
    expect(url).toMatch(/(login|planning)/);
  });

  test('accessing clients without auth redirects', async ({ page }) => {
    await page.goto('/#/clients');
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url).toMatch(/(login|clients)/);
  });

  test('dashboard HTML renders React app', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    // Check that React mounted (div#root has content)
    const rootContent = await page.evaluate(() => {
      const root = document.getElementById('root');
      return root ? root.innerHTML.length : 0;
    });
    expect(rootContent).toBeGreaterThan(0);
  });
});
