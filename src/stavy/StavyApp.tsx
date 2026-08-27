import { Route, Routes } from "react-router-dom"
import { CanvasPage } from "./canvas/CanvasPage"
import { PageView } from "./PageView"
import { ChromeProvider, EyeToggle } from "./chrome"
import { CommentsProvider } from "./comments/store"
import { StavyDiagnostics } from "./diagnostics"

/**
 * The whole viewer as one element, mountable inside any react-router app.
 *
 * Root-mounted (the viewer is the app):
 *   <BrowserRouter><Routes><Route path="/*" element={<StavyApp />} /></Routes></BrowserRouter>
 *
 * Under a sub-path of an existing app (set `viewer.base` in stavy.json to the same prefix):
 *   <Route path="/canvas/*" element={<StavyApp />} />
 *
 * Routes are relative to the mount point, so nothing else changes.
 */
export function StavyApp() {
  return (
    <ChromeProvider>
      <CommentsProvider>
        <Routes>
          <Route path="/" element={<CanvasPage />} />
          <Route path="p/:pageId" element={<PageView />} />
        </Routes>
        <EyeToggle />
        {import.meta.env.DEV && <StavyDiagnostics />}
      </CommentsProvider>
    </ChromeProvider>
  )
}
