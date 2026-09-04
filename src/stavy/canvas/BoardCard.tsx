import { memo, useEffect, useState } from "react"
import type { BoardDef } from "../types"
import { useChrome } from "../chrome"

function prefersDark(theme: string) {
  if (theme === "dark") return true
  if (theme === "light") return false
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

/** Supporting material on the canvas: a Mermaid diagram, an image, or a text note. */
export const BoardCard = memo(function BoardCard({ board }: { board: BoardDef }) {
  const { theme } = useChrome()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dark = prefersDark(theme)

  useEffect(() => {
    if (board.kind !== "mermaid") return
    let cancelled = false
    ;(async () => {
      try {
        const mermaid = (await import("mermaid")).default
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? "dark" : "neutral",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          themeVariables: { fontSize: "14px" },
        })
        const { svg } = await mermaid.render(`ps-board-${board.id}-${dark ? "d" : "l"}`, board.source)
        if (!cancelled) setSvg(svg)
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [board.id, board.source, board.kind, dark])

  return (
    <div className="ps flex flex-col gap-2" style={{ width: board.width ?? 720 }} data-ps-ui>
      <div className="ps-board">
        {board.kind === "mermaid" &&
          (error ? (
            <div className="ps flex flex-col gap-2">
              <div className="ps-sub">{error}</div>
              <pre className="ps-mono text-[11px]" style={{ color: "var(--ps-muted)", whiteSpace: "pre-wrap" }}>{board.source}</pre>
            </div>
          ) : svg ? (
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="ps-skeleton" style={{ height: 160 }} />
          ))}
        {board.kind === "image" && <img src={board.source} alt={board.title} style={{ maxWidth: "100%", borderRadius: 8 }} />}
        {board.kind === "text" && <pre className="text-[13px]">{board.source}</pre>}
      </div>
      <div>
        <div className="ps-h3">{board.title}</div>
        {board.description && <div className="ps-sub">{board.description}</div>}
      </div>
    </div>
  )
})
