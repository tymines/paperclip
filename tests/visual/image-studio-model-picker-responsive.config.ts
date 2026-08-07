import { defineConfig } from "@playwright/test";

const port = 4177;

export default defineConfig({
  testDir: ".",
  testMatch: "image-studio-model-picker-responsive.spec.ts",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm --filter @paperclipai/ui exec vite --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/tests/fixtures/image-studio-model-picker.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  reporter: [["list"]],
  outputDir: "./test-results/image-studio-model-picker-responsive",
});
