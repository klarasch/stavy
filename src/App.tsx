import { BrowserRouter, Route, Routes } from "react-router-dom"
import { CanvasPage } from "./protoscope/canvas/CanvasPage"
import { PageView } from "./protoscope/PageView"
import { ChromeProvider, EyeToggle } from "./protoscope/chrome"
import { CommentsProvider } from "./protoscope/comments/store"

export default function App() {
  return (
    <ChromeProvider>
      <CommentsProvider>
        <BrowserRouter>
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
