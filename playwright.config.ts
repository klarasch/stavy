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
  // Specs that rewrite workspace files run last, on their own: a live viewer
  // reloads its manifest when stavy.json changes, which would otherwise race
  // whatever unrelated test is open in parallel.
  projects: [
    { name: "viewer", testIgnore: /(writes|comments)\.spec\.ts/ },
    { name: "writes", testMatch: /writes\.spec\.ts/, dependencies: ["viewer"] },
    // Comments share one stavy-content/comments.json: their own group, after the manifest writes.
    { name: "comments", testMatch: /comments\.spec\.ts/, dependencies: ["writes"] },
  ],
})
