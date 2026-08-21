import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"

// Protoscope slice plugin: when PROTO=<prototype-id> is set, the build only
// includes the pages declared in that prototype slice of protoscope.json.
function protoscopeSlice(): Plugin {
  const manifestPath = fileURLToPath(new URL("./protoscope.json", import.meta.url))
  const virtualId = "virtual:proto-pages"
  const resolvedId = "\0" + virtualId

  return {
    name: "protoscope-slice",
    config() {
      return {
        define: {
          __PROTO_SLICE__: JSON.stringify(process.env.PROTO ?? null),
        },
      }
    },
    resolveId(id) {
      if (id === virtualId) return resolvedId
    },
    load(id) {
      if (id !== resolvedId) return
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
      const sliceId = process.env.PROTO
      const slice = sliceId
        ? manifest.prototypes.find((p: { id: string }) => p.id === sliceId)
        : null
      if (sliceId && !slice) {
        throw new Error(
          `PROTO="${sliceId}" does not match any prototype in protoscope.json. ` +
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
  plugins: [react(), tailwindcss(), protoscopeSlice()],
  // Keep React component names in production builds so the inspector can
  // show "Badge" instead of "Ct" on deployed prototypes.
  esbuild: { keepNames: true },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
})
