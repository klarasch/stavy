import { defineConfig } from "@playwright/test"

// STAVY_PORT lets several checkouts (worktrees, CI shards) run their own dev
// server side by side; the default matches `npm run dev`.
const port = Number(process.env.STAVY_PORT ?? 5173)

export default defineConfig({
  testDir: "tests",
  timeout: 20_000,
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1280, height: 832 } },
  webServer: { command: `npm run dev -- --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 30_000 },
  reporter: [["list"]],
})
