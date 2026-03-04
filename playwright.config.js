const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'site',
      use: { baseURL: 'http://localhost:5500' },
      testMatch: /site\..*\.spec\.js/,
    },
    {
      name: 'dashboard',
      use: { baseURL: 'http://localhost:5174' },
      testMatch: /dashboard\..*\.spec\.js/,
    },
  ],
  webServer: [
    {
      command: 'npx serve -l 5500 --no-clipboard',
      port: 5500,
      reuseExistingServer: true,
      timeout: 10000,
    },
    {
      command: 'cd dashboard && npm run dev',
      port: 5174,
      reuseExistingServer: true,
      timeout: 15000,
    },
  ],
});
