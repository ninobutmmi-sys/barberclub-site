const { test, expect } = require('@playwright/test');

test.describe('PWA', () => {
  test('manifest.json is accessible and valid', async ({ page }) => {
    const response = await page.goto('/config/manifest.json');
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(manifest.name).toContain('BarberClub');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons).toBeDefined();
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('landing page references manifest', async ({ page }) => {
    await page.goto('/');
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveCount(1);
    const href = await manifestLink.getAttribute('href');
    expect(href).toContain('manifest');
  });

  test('service worker file is accessible', async ({ page }) => {
    const response = await page.goto('/sw.js');
    expect(response.status()).toBe(200);
    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toContain('javascript');
  });

  test('landing page references service worker', async ({ page }) => {
    await page.goto('/');
    const swRef = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        if (s.textContent.includes('serviceWorker') || s.textContent.includes('sw.js')) {
          return true;
        }
      }
      return false;
    });
    expect(swRef).toBeTruthy();
  });

  test('robots.txt is accessible', async ({ page }) => {
    const response = await page.goto('/config/robots.txt');
    expect(response.status()).toBe(200);
  });

  test('sitemap.xml is accessible', async ({ page }) => {
    const response = await page.goto('/config/sitemap.xml');
    expect(response.status()).toBe(200);
  });
});
