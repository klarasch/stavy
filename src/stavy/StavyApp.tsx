import { lazy, Suspense } from "react"
import { Route, Routes, useSearchParams } from "react-router-dom"
import { CanvasPage } from "./canvas/CanvasPage"
import { PageView } from "./PageView"
import { ChromeProvider, EyeToggle } from "./chrome"
import { CommentsProvider } from "./comments/store"
import { useManifestSync } from "./dev"

// Boards and docs are their own chunks (with the Markdown renderer): the map and the player never pay for them.
const BoardView = lazy(() => import("./boards/BoardView").then((m) => ({ default: m.BoardView })))
const DocsView = lazy(() => import("./boards/DocsView").then((m) => ({ default: m.DocsView })))
const Blank = () => <div className="h-screen" style={{ background: "var(--ps-canvas-bg)" }} />

/**
 * The whole viewer. It routes by query string only — `?p=<page>` opens the
 * player, `?b=<board>` an authored board, `?doc=<id>` the docs, nothing the
 * map (canvas) — so a single static `index.html` serves every deep link
 * without rewrite rules (GitHub Pages, S3, a folder on a server).
 */
function Root() {
  const [sp] = useSearchParams()
  if (sp.get("p")) return <PageView />
  // Keyed by board id: switching boards starts a fresh view (its own viewport, history).
  if (sp.get("b"))
    return (
      <Suspense fallback={<Blank />}>
        <BoardView key={sp.get("b")} />
      </Suspense>
    )
  if (sp.has("doc"))
    return (
      <Suspense fallback={<Blank />}>
        <DocsView />
      </Suspense>
    )
  return <CanvasPage />
}

export function StavyApp() {
  useManifestSync()
  return (
    <ChromeProvider>
      <CommentsProvider>
        <Routes>
          <Route path="*" element={<Root />} />
        </Routes>
        <EyeToggle />
      </CommentsProvider>
    </ChromeProvider>
  )
}
