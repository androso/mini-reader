import { defineConfig, devices } from "@playwright/test";

const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;
if (!e2eDatabaseUrl) {
    throw new Error(
        "E2E_DATABASE_URL is required (no fallback to DATABASE_URL)"
    );
}

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: false,
    workers: 1,
    reporter: [
        ["list"],
        [
            "html",
            { outputFolder: "../../.tmp/playwright-report", open: "never" },
        ],
    ],
    outputDir: "../../.tmp/playwright",
    use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:3001",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: [
        {
            command: "pnpm --filter @reader/api dev",
            url: "http://127.0.0.1:3000/health",
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            env: {
                ...process.env,
                DATABASE_URL: e2eDatabaseUrl,
                NODE_ENV: "test",
                PORT: "3000",
                JWT_SECRET: "e2e-jwt-secret",
                GOOGLE_CLIENT_ID: "e2e.apps.googleusercontent.com",
                OPENAI_API_KEY: "e2e-openai-key",
                FRONTEND_URL: "http://127.0.0.1:3001",
                STORAGE_DRIVER: "local",
                LOCAL_STORAGE_DIR: ".tmp/e2e-storage",
                CODEX_OAUTH_ENABLED: "false",
                BOOK_PROCESSING_RUNNER_ENABLED: "false",
            },
        },
        {
            command: "pnpm --filter @reader/web dev",
            url: "http://127.0.0.1:3001",
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            env: {
                ...process.env,
                NEXT_PUBLIC_API_URL: "http://127.0.0.1:3000",
            },
        },
    ],
});
