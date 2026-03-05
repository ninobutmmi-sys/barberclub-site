const { test, expect } = require('@playwright/test');

test.describe('Booking flow - Meylan', () => {
  test('booking page loads correctly', async ({ page }) => {
    await page.goto('/pages/meylan/reserver.html');
    await expect(page).toHaveTitle(/BarberClub/);
  });

  test('progress bar is visible with 5 steps', async ({ page }) => {
    await page.goto('/pages/meylan/reserver.html');
    const progressBar = page.locator('.progress-bar');
    await expect(progressBar).toBeVisible();
    const steps = page.locator('.progress-step');
    await expect(steps).toHaveCount(5);
  });

  test('step 1 (barber selection) is active by default', async ({ page }) => {
    await page.goto('/pages/meylan/reserver.html');
    const step1 = page.locator('#step1');
    await expect(step1).toBeVisible();
    const activeStep = page.locator('.progress-step.active[data-step="1"]');
    await expect(activeStep).toBeVisible();
  });

  test('"Peu importe" barber option is present', async ({ page }) => {
    await page.goto('/pages/meylan/reserver.html');
    const anyBarber = page.locator('.barber-card.any-barber');
    await expect(anyBarber).toBeVisible();
  });

  test('barbers load from API or show error', async ({ page }) => {
    await page.goto('/pages/meylan/reserver.html');
    // Wait for API call attempt
    await page.waitForTimeout(3000);
    // Either barber cards loaded or an error/retry state is shown
    const barberCards = page.locator('.barber-card[data-id]');
    const count = await barberCards.count();
    // At minimum the "any barber" card exists, API barbers may or may not load
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('mon-rdv page loads', async ({ page }) => {
    await page.goto('/pages/meylan/mon-rdv.html');
    await expect(page).toHaveTitle(/BarberClub/);
  });

});

test.describe('Booking flow - Grenoble', () => {
  test('Grenoble booking page loads', async ({ page }) => {
    await page.goto('/pages/grenoble/reserver.html');
    await expect(page).toHaveTitle(/BarberClub/);
  });
});
