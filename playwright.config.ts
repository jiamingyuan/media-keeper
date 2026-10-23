import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

const dashboard = process.env.MY_DASHBOARD_ROOT ?? resolve(import.meta.dirname, '../my-dashboard')
export default defineConfig({
  testDir: './tests', testMatch: 'web.spec.ts', workers: 1, retries: 0,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? '/private/tmp/media-keeper-web-tests', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4185', browserName: 'chromium', viewport: { width: 1440, height: 1120 }, timezoneId: 'Asia/Shanghai', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    { command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4185 --strictPort', cwd: dashboard, url: 'http://127.0.0.1:4185', timeout: 60000, reuseExistingServer: false },
    { command: 'npm run build:web && npm run preview:web', url: 'http://127.0.0.1:8081/media-keeper/mf-manifest.json', timeout: 60000, reuseExistingServer: false },
  ],
})
