import { Route, Routes, useSearchParams } from "react-router-dom"
import { CanvasPage } from "./canvas/CanvasPage"
import { PageView } from "./PageView"
import { ChromeProvider, EyeToggle } from "./chrome"
import { CommentsProvider } from "./comments/store"

/**
 * The whole viewer. It routes by query string only — `?p=<page>` opens the
 * player, no `p` is the canvas — so a single static `index.html` serves every
 * deep link without rewrite rules (GitHub Pages, S3, a folder on a server).
 */
function Root() {
  const [sp] = useSearchParams()
  return sp.get("p") ? <PageView /> : <CanvasPage />
}

export function StavyApp() {
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
