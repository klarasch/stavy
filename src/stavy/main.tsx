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
const rootEl = document.getElementById("stavy-root")!
const root = createRoot(rootEl)
const override = rootEl.getAttribute("data-manifest") || new URLSearchParams(location.search).get("manifest")

loadManifest(override ?? undefined).then(
  () =>
    root.render(
      <StrictMode>
        <BrowserRouter basename={location.pathname.replace(/\/+$/, "")}>
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
