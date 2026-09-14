import { describe, it, expect } from "vitest"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// Blink never implemented the -webkit- prefixed `backdrop-filter`, so the
// built viewer CSS must keep the unprefixed property too. Lightning CSS (run
// by @tailwindcss/vite during `build:viewer`) has dropped it before when both
// forms were authored by hand in stavy.css — see that file's `.ps-glass` etc.
// This only runs when dist-viewer/ has already been built (`npm run
// build:viewer`); it's not itself responsible for building it.
const root = fileURLToPath(new URL("../..", import.meta.url))
const assetsDir = join(root, "dist-viewer/assets")
const cssFiles = existsSync(assetsDir) ? readdirSync(assetsDir).filter((f) => f.endsWith(".css")) : []

describe.skipIf(cssFiles.length === 0)("dist-viewer CSS", () => {
  it("keeps the unprefixed backdrop-filter alongside -webkit-backdrop-filter", () => {
    const css = cssFiles.map((f) => readFileSync(join(assetsDir, f), "utf8")).join("\n")
    expect(css).toMatch(/(?<!-webkit-)backdrop-filter:blur/)
  })
})
