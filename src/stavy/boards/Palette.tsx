import { useEffect, useMemo, useRef, useState } from "react"
import { BookOpen, FileText, Frame, Image, Layers, Plus, Search, StickyNote, Waypoints } from "../icons"
import { manifest } from "../manifest"
import { PsButton } from "../chrome"
import { StavyLayer } from "../toplayer"
import type { BoardItem } from "../types"
import { pickableStates } from "./resolve"

/** An item to add, without id or position (the board assigns both). */
export type NewItem = Omit<BoardItem, "id"> & Record<string, unknown>

type Step = null | "screen" | "flow" | "image"

/**
 * The "+" palette: note, Markdown, section, a screen at a state (searchable
 * list of every page × pinned state), a flow, an image by path or URL, a
 * Mermaid diagram. It only builds the item; the board places it.
 */
export function AddPalette({ onAdd }: { onAdd: (item: NewItem) => void }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>(null)
  const [q, setQ] = useState("")
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ right: number; top: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) close()
    }
    window.addEventListener("pointerdown", onDown, true)
    return () => window.removeEventListener("pointerdown", onDown, true)
  }, [open])

  const close = () => {
    setOpen(false)
    setStep(null)
    setQ("")
  }
  const add = (item: NewItem) => {
    onAdd(item)
    close()
  }

  const states = useMemo(() => (step === "screen" ? pickableStates() : []), [step])
  const query = q.trim().toLowerCase()
  const shown = states.filter((s) => !query || query.split(/\s+/).every((w) => s.search.includes(w))).slice(0, 80)
  const flows = manifest.scenarios.filter((s) => !query || `${s.label} ${s.id}`.toLowerCase().includes(query))

  return (
    <div ref={root} className="relative" data-ps-ui>
      <PsButton
        active={open}
        tip="Add to the board"
        tipBelow
        onClick={() => {
          if (open) return close()
          const r = root.current!.getBoundingClientRect()
          setAt({ right: window.innerWidth - r.right, top: r.bottom + 12 })
          setOpen(true)
        }}
      >
        <Plus /> Add
      </PsButton>
      {open && at && (
        <StavyLayer>
        <div
          ref={menu}
          className="ps ps-menu ps-palette"
          style={{ right: at.right, top: at.top }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation()
              step ? setStep(null) : close()
            }
          }}
        >
          {step === null && (
            <>
              <button className="ps-menu-item" onClick={() => add({ type: "note", text: "New note" } as NewItem)}>
                <StickyNote className="ps-menu-icon" /> Sticky note
              </button>
              <button className="ps-menu-item" onClick={() => add({ type: "markdown", md: "## Heading\n\nWrite the rule, the edge case, the why." } as NewItem)}>
                <FileText className="ps-menu-icon" /> Markdown
              </button>
              <button className="ps-menu-item" onClick={() => add({ type: "section", title: "Section", items: [] } as NewItem)}>
                <Frame className="ps-menu-icon" /> Section
              </button>
              <div className="ps-menu-sep" />
              <button className="ps-menu-item" onClick={() => setStep("screen")}>
                <Layers className="ps-menu-icon" /> Screen at a state…
              </button>
              <button className="ps-menu-item" onClick={() => setStep("flow")} disabled={!manifest.scenarios.length}>
                <BookOpen className="ps-menu-icon" /> Flow…
              </button>
              <button className="ps-menu-item" onClick={() => setStep("image")}>
                <Image className="ps-menu-icon" /> Image…
              </button>
              <button className="ps-menu-item" onClick={() => add({ type: "mermaid", code: "flowchart LR\n  A[Draft] --> B[Submitted] --> C[Approved]" } as NewItem)}>
                <Waypoints className="ps-menu-icon" /> Mermaid diagram
              </button>
            </>
          )}
          {(step === "screen" || step === "flow") && (
            <>
              <div className="ps-palette-search">
                <Search />
                <input autoFocus placeholder={step === "screen" ? "Search screens and states" : "Search flows"} value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="ps-palette-list">
                {step === "screen" &&
                  shown.map((s, i) => (
                    <button
                      key={i}
                      className="ps-menu-item"
                      onClick={() =>
                        add({ type: "screen", screen: s.page.id, ...(s.state ? { state: s.state } : {}), ...(s.dims ? { dims: s.dims } : {}) } as NewItem)
                      }
                    >
                      <span className="truncate">{s.page.label}</span>
                      <span className="ps-palette-k truncate">{s.label === s.page.label ? "default" : s.label}</span>
                    </button>
                  ))}
                {step === "screen" && (
                  <button className="ps-menu-item ps-palette-all" onClick={() => setStep(null)}>
                    ← Back
                  </button>
                )}
                {step === "flow" &&
                  flows.map((sc) => (
                    <button key={sc.id} className="ps-menu-item" onClick={() => add({ type: "flow", flow: sc.id } as NewItem)}>
                      <span className="truncate">{sc.label}</span>
                      <span className="ps-palette-k">{sc.steps.length} steps</span>
                    </button>
                  ))}
              </div>
            </>
          )}
          {step === "image" && (
            <form
              className="flex flex-col gap-2 p-2"
              style={{ width: 300 }}
              onSubmit={(e) => {
                e.preventDefault()
                if (q.trim()) add({ type: "image", src: q.trim() } as NewItem)
              }}
            >
              <div className="ps-sub">A path inside stavy-content (assets/flow.svg) or a URL.</div>
              <input autoFocus className="ps-input" placeholder="assets/sketch.png" value={q} onChange={(e) => setQ(e.target.value)} />
              <button type="submit" className="ps-btn ps-btn-primary justify-center" disabled={!q.trim()}>
                Add image
              </button>
            </form>
          )}
        </div>
        </StavyLayer>
      )}
    </div>
  )
}
