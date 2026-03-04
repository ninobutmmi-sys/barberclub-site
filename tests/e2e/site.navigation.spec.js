const { test, expect } = require('@playwright/test');

test.describe('Site navigation', () => {
  test('landing page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/BarberClub/);
  });

  test('Meylan hub page loads', async ({ page }) => {
    await page.goto('/pages/meylan/');
    await expect(page.locator('body')).toContainText(/Meylan|BarberClub/i);
  });

  test('Grenoble hub page loads', async ({ page }) => {
    await page.goto('/pages/grenoble/');
    await expect(page.locator('body')).toContainText(/Grenoble|BarberClub/i);
  });

  test('Meylan prestations page loads', async ({ page }) => {
    await page.goto('/pages/meylan/prestations.html');
    await expect(page.locator('body')).toContainText(/prestation|service|tarif/i);
  });

  test('Meylan contact page loads', async ({ page }) => {
    await page.goto('/pages/meylan/contact.html');
    await expect(page.locator('body')).toContainText(/contact|adresse|horaire/i);
  });

  test('Meylan barbers page loads', async ({ page }) => {
    await page.goto('/pages/meylan/barbers.html');
    await expect(page.locator('body')).toContainText(/barber|equipe|Lucas|Julien/i);
  });

  test('Grenoble prestations page loads', async ({ page }) => {
    await page.goto('/pages/grenoble/prestations.html');
    await expect(page.locator('body')).toContainText(/prestation|service|tarif/i);
  });

  test('Grenoble contact page loads', async ({ page }) => {
    await page.goto('/pages/grenoble/contact.html');
    await expect(page.locator('body')).toContainText(/contact|adresse|horaire/i);
  });

  test('CGU page loads', async ({ page }) => {
    await page.goto('/pages/legal/cgu.html');
    await expect(page.locator('body')).toContainText(/conditions/i);
  });

  test('mentions legales page loads', async ({ page }) => {
    await page.goto('/pages/legal/mentions-legales.html');
    await expect(page.locator('body')).toContainText(/mention/i);
  });

  test('politique de confidentialite page loads', async ({ page }) => {
    await page.goto('/pages/legal/politique-confidentialite.html');
    await expect(page.locator('body')).toContainText(/confidentialit/i);
  });

  test('404 page works', async ({ page }) => {
    await page.goto('/pages/404.html');
    await expect(page.locator('body')).toContainText(/404|introuvable|perdu/i);
  });

  test('Meylan galerie page loads', async ({ page }) => {
    await page.goto('/pages/meylan/galerie.html');
    await expect(page.locator('body')).toContainText(/galerie|photo/i);
  });

  test('Grenoble galerie page loads', async ({ page }) => {
    await page.goto('/pages/grenoble/galerie.html');
    await expect(page.locator('body')).toContainText(/galerie|photo/i);
  });
});
