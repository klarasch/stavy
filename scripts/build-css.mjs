#!/usr/bin/env node
// Prebuild the viewer CSS (Tailwind utilities scoped to src/stavy + chrome tokens)
// into prebuilt/stavy.css. The file is committed so `init.mjs` works from a bare
// clone with no node_modules (offline / locked-down npm). Re-run after editing
// anything in src/stavy that adds new utility classes:  npm run build:css
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const css = readFileSync(join(root, "src/index.css"), "utf8")
const chromeStart = css.indexOf("/* =====")
const chrome = chromeStart >= 0 ? css.slice(chromeStart) : css
mkdirSync(join(root, "node_modules/.cache"), { recursive: true })
const tmpIn = join(root, "node_modules/.cache/stavy-prebuild.css")
writeFileSync(tmpIn, `@import "tailwindcss/theme" layer(theme);\n@import "tailwindcss/utilities" layer(utilities);\n@source "../../src/stavy";\n\n${chrome}`)
mkdirSync(join(root, "prebuilt"), { recursive: true })
execFileSync(join(root, "node_modules/.bin/tailwindcss"), ["-i", tmpIn, "-o", join(root, "prebuilt/stavy.css")], { stdio: "inherit" })
console.log("prebuilt/stavy.css written")
