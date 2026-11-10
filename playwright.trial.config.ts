import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testDir: "./tests/trial",
  outputDir: "test-results/trial",
  use: { ...base.use, baseURL: process.env.TRIAL_BASE_URL ?? "http://127.0.0.1:8791" },
  webServer: process.env.TRIAL_BASE_URL ? undefined : {
    command: `pnpm --filter @webflipper/worker exec wrangler dev --local --port 8791 --persist-to .wrangler/trial-${Date.now()} --var TRIAL_CODE:local-only-test-code`,
    url: "http://127.0.0.1:8791",
    reuseExistingServer: false,
    timeout: 60000
  }
});
