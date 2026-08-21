import { BrowserRouter, Route, Routes } from "react-router-dom"
import { CanvasPage } from "./protopact/canvas/CanvasPage"
import { PageView } from "./protopact/PageView"
import { ChromeProvider, EyeToggle } from "./protopact/chrome"
import { CommentsProvider } from "./protopact/comments/store"

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
