import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import "./stavy.css"
import { loadManifest } from "./manifest"
import { StavyApp } from "./StavyApp"

/**
 * The viewer is a standalone static page, served next to the prototype
 * (same origin). It loads `stavy.json` at runtime and renders the prototype's
 * URLs — it never imports the prototype.
 */
// The router writes `/stavy?p=…` (no slash) when it updates the query, and a
// dev server (or a host without a redirect) answers a reload of that with a
// 404. Keep the directory form: every URL the viewer writes ends in `/`.
if (!/\.html$/.test(location.pathname)) {
  const dir = location.pathname.replace(/\/+$/, "")
  for (const m of ["pushState", "replaceState"] as const) {
    const orig = history[m].bind(history)
    history[m] = (state: unknown, title: string, url?: string | URL | null) => {
      if (dir && url != null) {
        const u = new URL(String(url), location.href)
        if (u.pathname === dir) {
          u.pathname = `${dir}/`
          url = u.pathname + u.search + u.hash
        }
      }
      orig(state, title, url)
    }
  }
}

const rootEl = document.getElementById("stavy-root")!
const root = createRoot(rootEl)
const override = rootEl.getAttribute("data-manifest") || new URLSearchParams(location.search).get("manifest")

loadManifest(override ?? undefined).then(
  () =>
    root.render(
      <StrictMode>
        {/* No basename: the viewer routes by query string only, and every link it
            builds (pageUrl, canvasUrl) is already absolute — a basename would be
            prefixed a second time (/stavy/stavy/?p=…). */}
        <BrowserRouter>
          <StavyApp />
        </BrowserRouter>
      </StrictMode>
    ),
  (e: unknown) =>
    root.render(
      <div className="ps h-screen flex items-center justify-center p-8" style={{ background: "var(--ps-canvas-bg)" }}>
        <div className="ps-glass-strong rounded-2xl p-6 max-w-lg text-[13px]">
          <div className="font-semibold mb-2">Stavy could not load the manifest</div>
          <p style={{ color: "var(--ps-muted)" }}>
            {String((e as Error)?.message ?? e)}. The viewer expects <code className="ps-mono">stavy.json</code> at the
            prototype's root (or pass <code className="ps-mono">?manifest=/path/to/stavy.json</code>).
          </p>
        </div>
      </div>
    )
)
