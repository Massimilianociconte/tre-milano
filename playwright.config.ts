import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Porta dedicata: il gate non riusa processi Astro aperti per QA manuale,
// evitando cache Vite stale dopo cambi lockfile o dipendenze React.
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
const baseURL = externalBaseURL || 'http://127.0.0.1:4178';
const artifactRoot = process.env.PLAYWRIGHT_ARTIFACTS_DIR
  ?? '/tmp/tre-milano-playwright';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 3,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: join(artifactRoot, 'results'),
  reporter: [
    ['line'],
    ['html', { outputFolder: join(artifactRoot, 'report'), open: 'never' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    browserName: 'chromium',
    colorScheme: 'light',
    locale: 'it-IT',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium-360', use: { viewport: { width: 360, height: 800 } } },
    { name: 'chromium-768', use: { viewport: { width: 768, height: 1024 } } },
    { name: 'chromium-1440', use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: externalBaseURL ? undefined : {
    command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 4178',
    url: `${baseURL}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
