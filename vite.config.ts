import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"
import { readFileSync, writeFileSync } from "node:fs"
import Ajv2020 from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

/**
 * This config builds two things from one repo:
 *   /          the Orbit demo prototype (a normal React app)
 *   /stavy/    the Stavy viewer, a static page that loads Orbit's URLs in iframes
 *
 * Adopters don't need any of this: they copy the built viewer into their
 * app's public folder and serve `stavy.json` next to it (see docs/ADOPTION.md).
 * The plugin below only (1) serves the repo-root `stavy.json` at /stavy.json
 * in dev and emits it on build, and (2) offers the dev-only annotation
 * endpoint the viewer's comment composer uses to write annotations back.
 */
const MAX_ANNOTATION_BODY_BYTES = 1_000_000

function stavyManifest(): Plugin {
  const manifestPath = fileURLToPath(new URL("./stavy.json", import.meta.url))
  const schemaPath = fileURLToPath(new URL("./spec/stavy.schema.json", import.meta.url))
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  const validateManifest = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")))

  return {
    name: "stavy-manifest",
    config() {
      return {
        define: {
          // Absolute workspace root, dev only — lets the inspector open files in the editor.
          __STAVY_ROOT__: JSON.stringify(process.env.NODE_ENV === "production" ? null : process.cwd()),
        },
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0]
        if (path.endsWith("/stavy.json")) {
          res.setHeader("content-type", "application/json")
          res.setHeader("cache-control", "no-store")
          return res.end(readFileSync(manifestPath))
        }
        next()
      })
      // Dev-only authoring endpoint: the viewer can save a design annotation
      // straight into stavy.json (designers annotate without prompting).
      server.middlewares.use("/__stavy/annotation", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405
          return res.end()
        }
        let body = ""
        let size = 0
        let tooLarge = false
        req.on("data", (c) => {
          if (tooLarge) return
          size += c.length
          if (size > MAX_ANNOTATION_BODY_BYTES) {
            tooLarge = true
            res.statusCode = 413
            res.end("payload too large")
            req.destroy()
            return
          }
          body += c
        })
        req.on("end", () => {
          if (tooLarge) return
          try {
            const { page: pageId, target, title, note } = JSON.parse(body)
            const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
            const page = manifest.pages.find((p: { id: string }) => p.id === pageId)
            if (!page || !target || !title) throw new Error("page, target and title are required")
            page.annotations = page.annotations ?? []
            const existing = page.annotations.find((a: { target: string }) => a.target === target)
            if (existing) Object.assign(existing, { title, note: note ?? "" })
            else page.annotations.push({ target, title, note: note ?? "" })
            if (!validateManifest(manifest)) {
              res.statusCode = 400
              res.setHeader("content-type", "application/json")
              res.end(JSON.stringify({ ok: false, errors: validateManifest.errors }))
              return
            }
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
    handleHotUpdate({ file, server }) {
      // The viewer fetches the manifest at runtime: reload it when the file changes.
      if (file === manifestPath) server.ws.send({ type: "full-reload" })
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "stavy.json", source: readFileSync(manifestPath, "utf8") })
    },
  }
}

export default defineConfig({
  // Sub-path hosting (GitHub Pages): BASE_PATH=/stavy/ npm run build
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss(), stavyManifest()],
  // Keep React component names in production builds so the inspector can
  // show "Badge" instead of "Ct" on deployed prototypes.
  esbuild: { keepNames: true },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL("./index.html", import.meta.url)),
        stavy: fileURLToPath(new URL("./stavy/index.html", import.meta.url)),
      },
    },
  },
})
