import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"

/** The entry lives at stavy/index.html in this repo; the redistributable wants it at the folder root. */
function flatten(): Plugin {
  return {
    name: "stavy-flatten",
    closeBundle() {
      const out = fileURLToPath(new URL("./dist-viewer", import.meta.url))
      const nested = join(out, "stavy/index.html")
      if (!existsSync(nested)) return
      const html = readFileSync(nested, "utf8").replace(/(src|href)="\.\.\//g, '$1="./')
      mkdirSync(out, { recursive: true })
      writeFileSync(join(out, "index.html"), html)
      rmSync(join(out, "stavy"), { recursive: true, force: true })
    },
  }
}

/**
 * Builds the viewer alone, as a self-contained static folder with relative
 * asset paths — drop `dist-viewer/` into any app's `public/stavy/` and open
 * `/stavy/` (or `/stavy/index.html`). No bundler integration on the app side.
 *
 *   npx vite build -c vite.viewer.config.ts
 */
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), flatten()],
  // The demo's public/ (snapshots, the demo manifest) must not leak into the redistributable.
  publicDir: false,
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  define: { __STAVY_ROOT__: "null" },
  build: {
    outDir: "dist-viewer",
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL("./stavy/index.html", import.meta.url)) },
  },
})
