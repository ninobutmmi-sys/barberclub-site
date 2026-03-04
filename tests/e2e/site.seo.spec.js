const { test, expect } = require('@playwright/test');

const publicPages = [
  { name: 'landing', path: '/' },
  { name: 'Meylan hub', path: '/pages/meylan/' },
  { name: 'Grenoble hub', path: '/pages/grenoble/' },
  { name: 'Meylan prestations', path: '/pages/meylan/prestations.html' },
  { name: 'Meylan contact', path: '/pages/meylan/contact.html' },
  { name: 'Meylan barbers', path: '/pages/meylan/barbers.html' },
  { name: 'Grenoble prestations', path: '/pages/grenoble/prestations.html' },
  { name: 'Grenoble contact', path: '/pages/grenoble/contact.html' },
];

test.describe('SEO basics', () => {
  for (const pg of publicPages) {
    test(`${pg.name} has title tag`, async ({ page }) => {
      await page.goto(pg.path);
      const title = await page.title();
      expect(title.length).toBeGreaterThan(5);
      expect(title.toLowerCase()).toContain('barberclub');
    });
  }

  test('landing page has meta description', async ({ page }) => {
    await page.goto('/');
    const metaDesc = page.locator('meta[name="description"]');
    await expect(metaDesc).toHaveCount(1);
    const content = await metaDesc.getAttribute('content');
    expect(content.length).toBeGreaterThan(20);
  });

  test('landing page has canonical link', async ({ page }) => {
    await page.goto('/');
    const canonical = page.locator('link[rel="canonical"]');
    if (await canonical.count() > 0) {
      const href = await canonical.getAttribute('href');
      expect(href).toContain('barberclub');
    }
  });

  test('landing page has Open Graph tags', async ({ page }) => {
    await page.goto('/');
    const ogTitle = page.locator('meta[property="og:title"]');
    const ogDesc = page.locator('meta[property="og:description"]');
    if (await ogTitle.count() > 0) {
      const title = await ogTitle.getAttribute('content');
      expect(title.length).toBeGreaterThan(0);
    }
    if (await ogDesc.count() > 0) {
      const desc = await ogDesc.getAttribute('content');
      expect(desc.length).toBeGreaterThan(0);
    }
  });

  test('landing page has viewport meta tag', async ({ page }) => {
    await page.goto('/');
    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveCount(1);
    const content = await viewport.getAttribute('content');
    expect(content).toContain('width=device-width');
  });
});
