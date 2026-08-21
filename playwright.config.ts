import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "tests",
  timeout: 20_000,
  use: { baseURL: "http://localhost:5173", viewport: { width: 1280, height: 832 } },
  webServer: { command: "npm run dev", url: "http://localhost:5173", reuseExistingServer: true, timeout: 30_000 },
  reporter: [["list"]],
})
