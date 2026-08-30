import { defineConfig } from "vitest/config"

// Separate from vite.config.ts / playwright.config.ts on purpose: Playwright
// owns `tests/**/*.spec.ts` (its default testMatch), so unit test files here
// use a `.unit.ts` suffix instead of `.test.ts`/`.spec.ts` — that keeps
// Playwright's directory walk of `tests/` from tripping over files that
// import `vitest`, and keeps Vitest from picking up Playwright specs.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.unit.ts", "tests/unit/**/*.unit.tsx"],
  },
})
