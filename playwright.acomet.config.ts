import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: 'acomet.spec.ts', workers: 1, retries: 0,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? '/private/tmp/media-keeper-acomet-tests', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4310', browserName: 'chromium', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    { command: 'npm run build:acomet && npm run preview:acomet', url: 'http://localhost:5174', timeout: 60000, reuseExistingServer: false },
    { command: 'npm run acomet', url: 'http://127.0.0.1:4310/api/dev-config', timeout: 30000, reuseExistingServer: false },
    { command: 'node tests/acomet-server.mjs', url: 'http://127.0.0.1:3002/api/health', timeout: 30000, reuseExistingServer: false },
  ],
})
