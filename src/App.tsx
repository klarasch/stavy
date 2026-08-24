import { BrowserRouter, Route, Routes } from "react-router-dom"
import { StavyApp } from "./stavy/StavyApp"

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Routes>
        <Route path="/*" element={<StavyApp />} />
      </Routes>
    </BrowserRouter>
  )
}
