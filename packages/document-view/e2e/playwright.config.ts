import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    testMatch: '**/*.spec.ts',
    fullyParallel: true,
    forbidOnly: true,
    retries: 0,
    reporter: 'list',
    timeout: 30_000,
    expect: { timeout: 5_000 },
    use: {
        baseURL: 'http://127.0.0.1:5174',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                channel: process.env.CI
                    || process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM
                    ? undefined
                    : 'chrome',
            },
        },
    ],
    webServer: {
        command: 'pnpm exec vite --config vite.config.ts',
        url: 'http://127.0.0.1:5174/document-core-view/index.html',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
    },
});
