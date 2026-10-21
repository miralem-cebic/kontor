import { defineConfig } from '@playwright/test';

// End-to-end tests against the production build via file:// in the installed Chrome.
// In test mode (?e2e) the company folders are simulated in localStorage.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  reporter: [['list']],
  workers: 3,
  use: {
    channel: process.env.BROWSER_CHANNEL || 'chrome',
    headless: !process.env.HEADED,
    viewport: { width: 1400, height: 900 },
    locale: 'de-DE',
    trace: 'retain-on-failure',
  },
});
