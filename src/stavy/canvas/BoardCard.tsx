import { memo, useEffect, useState } from "react"
import type { BoardDef } from "../types"
import { useChrome } from "../chrome"

function prefersDark(theme: string) {
  if (theme === "dark") return true
  if (theme === "light") return false
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

/**
 * Supporting material on the canvas: a Mermaid diagram, an image, or a text
 * note. An image board may carry `callouts` — the same numbered callouts and
 * legend as a page's anatomy, so a crop of a menu can number its options.
 * Anchored to a page (`board.page`) it is a *figure* and sits inside that
 * page's area, narrower by default so it never dwarfs the page's cards.
 */
export const BoardCard = memo(function BoardCard({ board, figure = false }: { board: BoardDef; figure?: boolean }) {
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

  // Callouts are an image-only affordance (SPEC §1.7); the validator says so
  // too, but a manifest that slipped through must not render half a figure.
  const callouts = board.kind === "image" ? board.callouts ?? [] : []
  const width = board.width ?? (figure && board.kind === "image" ? 360 : 720)

  return (
    <div className="ps flex items-start gap-6" data-ps-ui>
    <div className="flex flex-col gap-2" style={{ width }}>
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
        {board.kind === "image" && (
          <div className="ps-figure">
            <img src={board.source} alt={board.title} draggable={false} />
            {callouts.map((c, i) => (
              <div key={i}>
                {c.w != null && c.h != null && (
                  <div
                    className="ps-anat-box"
                    style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
                  />
                )}
                <div className="ps-anat-tag" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}>{i + 1}</div>
              </div>
            ))}
          </div>
        )}
        {board.kind === "text" && <pre className="text-[13px]">{board.source}</pre>}
      </div>
      <div>
        <div className="ps-h3">{board.title}</div>
        {board.description && <div className="ps-sub">{board.description}</div>}
      </div>
    </div>
    {callouts.length > 0 && (
      <div className="flex flex-col gap-2.5 pt-1" style={{ width: 260 }}>
        {callouts.map((c, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className="ps-anat-tag" style={{ position: "static", transform: "none", flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
            <div>
              <div className="text-[12.5px] font-semibold leading-tight">{c.title}</div>
              {c.note && <div className="ps-sub leading-snug mt-0.5">{c.note}</div>}
            </div>
          </div>
        ))}
      </div>
    )}
    </div>
  )
})
