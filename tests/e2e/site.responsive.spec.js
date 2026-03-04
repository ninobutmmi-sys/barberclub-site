const { test, expect } = require('@playwright/test');

const viewports = [
  { name: 'mobile (iPhone X)', width: 375, height: 812 },
  { name: 'tablet (iPad)', width: 768, height: 1024 },
  { name: 'desktop (1920)', width: 1920, height: 1080 },
];

const pages = [
  { name: 'landing', path: '/' },
  { name: 'booking Meylan', path: '/pages/meylan/reserver.html' },
  { name: 'prestations Meylan', path: '/pages/meylan/prestations.html' },
  { name: 'contact Meylan', path: '/pages/meylan/contact.html' },
];

for (const vp of viewports) {
  test.describe(`Responsive - ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const pg of pages) {
      test(`${pg.name} renders without horizontal overflow`, async ({ page }) => {
        await page.goto(pg.path);
        await page.waitForLoadState('domcontentloaded');
        const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
        const windowWidth = await page.evaluate(() => window.innerWidth);
        // Allow 10px tolerance for rounding and minor overflow
        expect(bodyScrollWidth).toBeLessThanOrEqual(windowWidth + 10);
      });
    }
  });
}

test.describe('Responsive - mobile specific', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('landing page is visible and interactive on mobile', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    // Check that some clickable element exists
    const links = page.locator('a[href]');
    expect(await links.count()).toBeGreaterThan(0);
  });
});
