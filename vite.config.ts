import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"

// Stavy slice plugin: when PROTO=<prototype-id> is set, the build only
// includes the pages declared in that prototype slice of stavy.json.
function stavySlice(): Plugin {
  const manifestPath = fileURLToPath(new URL("./stavy.json", import.meta.url))
  const virtualId = "virtual:proto-pages"
  const resolvedId = "\0" + virtualId
  const stringsId = "virtual:proto-strings"
  const resolvedStringsId = "\0" + stringsId
  // mermaid is optional: boards of kind "mermaid" render with it, show their
  // source without it. Resolved here because a bare import("mermaid") makes
  // Vite fail at transform time when the package is absent.
  const mermaidId = "virtual:proto-mermaid"
  const resolvedMermaidId = "\0" + mermaidId
  let hasMermaid = false
  try {
    createRequire(import.meta.url).resolve("mermaid")
    hasMermaid = true
  } catch {}

  return {
    name: "stavy-slice",
    config() {
      return {
        define: {
          __PROTO_SLICE__: JSON.stringify(process.env.PROTO ?? null),
          // Absolute workspace root, dev only — lets the inspector open files in the editor.
          __PROTO_ROOT__: JSON.stringify(process.env.NODE_ENV === "production" ? null : process.cwd()),
        },
      }
    },
    // Dev-only authoring endpoint: the viewer can save a design annotation
    // straight into stavy.json (designers annotate without prompting;
    // HMR reloads the manifest and the pin appears).
    configureServer(server) {
      server.middlewares.use("/__stavy/annotation", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405
          return res.end()
        }
        let body = ""
        req.on("data", (c) => (body += c))
        req.on("end", () => {
          try {
            const { page: pageId, target, title, note } = JSON.parse(body)
            const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
            const page = manifest.pages.find((p: { id: string }) => p.id === pageId)
            if (!page || !target || !title) throw new Error("page, target and title are required")
            page.annotations = page.annotations ?? []
            const existing = page.annotations.find((a: { target: string }) => a.target === target)
            if (existing) Object.assign(existing, { title, note: note ?? "" })
            else page.annotations.push({ target, title, note: note ?? "" })
            writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
            res.setHeader("content-type", "application/json")
            res.end(JSON.stringify({ ok: true, count: page.annotations.length }))
          } catch (e) {
            res.statusCode = 400
            res.end(String(e))
          }
        })
      })
    },
    resolveId(id) {
      if (id === virtualId) return resolvedId
      if (id === stringsId) return resolvedStringsId
      if (id === mermaidId) return hasMermaid ? this.resolve("mermaid") : resolvedMermaidId
    },
    load(id) {
      if (id === resolvedMermaidId) return "export default null\n"
      if (id === resolvedStringsId) {
        // The copy catalog, if the manifest points at one — the inspector uses it to show copy keys.
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
        const file = manifest.strings ? fileURLToPath(new URL(manifest.strings, new URL("./", import.meta.url))) : null
        return `export const strings = ${file ? readFileSync(file, "utf8") : "{}"}\n`
      }
      if (id !== resolvedId) return
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
      const sliceId = process.env.PROTO
      const slice = sliceId
        ? manifest.prototypes.find((p: { id: string }) => p.id === sliceId)
        : null
      if (sliceId && !slice) {
        throw new Error(
          `PROTO="${sliceId}" does not match any prototype in stavy.json. ` +
            `Known: ${manifest.prototypes.map((p: { id: string }) => p.id).join(", ")}`
        )
      }
      const pages = manifest.pages.filter(
        (p: { id: string }) => !slice || slice.pages.includes(p.id)
      )
      const entries = pages
        .map(
          (p: { id: string; module?: string }) =>
            `  ${JSON.stringify(p.id)}: () => import(${JSON.stringify(
              "/" + (p.module ?? `src/demo/pages/${p.id}.tsx`).replace(/^\/+/, "")
            )})`
        )
        .join(",\n")
      return `export const pageModules = {\n${entries}\n}\n`
    },
  }
}

export default defineConfig({
  // Sub-path hosting (GitHub Pages): BASE_PATH=/stavy/ npm run build
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss(), stavySlice()],
  // Keep React component names in production builds so the inspector can
  // show "Badge" instead of "Ct" on deployed prototypes.
  esbuild: { keepNames: true },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
})
