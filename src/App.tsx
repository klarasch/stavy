import { BrowserRouter, Route, Routes } from "react-router-dom"
import { CanvasPage } from "./stavy/canvas/CanvasPage"
import { PageView } from "./stavy/PageView"
import { ChromeProvider, EyeToggle } from "./stavy/chrome"
import { CommentsProvider } from "./stavy/comments/store"

export default function App() {
  return (
    <ChromeProvider>
      <CommentsProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Routes>
            <Route path="/" element={<CanvasPage />} />
            <Route path="/p/:pageId" element={<PageView />} />
          </Routes>
          <EyeToggle />
        </BrowserRouter>
      </CommentsProvider>
    </ChromeProvider>
  )
}
