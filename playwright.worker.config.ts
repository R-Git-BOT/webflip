import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  outputDir: "test-results/worker",
  use: { ...base.use, baseURL: "http://127.0.0.1:8790" },
  webServer: {
    command: "pnpm --filter @webflipper/worker dev",
    url: "http://127.0.0.1:8790",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
});
