import { useState } from "react"
import { ChevronDown, ChevronRight, List } from "lucide-react"
import { manifest } from "../manifest"
import { cn } from "@/lib/utils"

/** Table of contents for the canvas: jump to any scenario, page, or component. */
export function CanvasToc({ onJump, className }: { onJump: (tocId: string) => void; className?: string }) {
  const [open, setOpen] = useState(true)
  const pages = manifest.pages.filter((p) => p.kind !== "component")
  const components = manifest.pages.filter((p) => p.kind === "component")
  return (
    <div className={cn("ps ps-glass rounded-2xl", className)}>
      <button className="ps-btn w-full justify-start h-8 px-2.5 rounded-2xl" onClick={() => setOpen((o) => !o)}>
        <List />
        <span className="font-semibold" style={{ color: "var(--ps-fg)" }}>Contents</span>
        <span className="ml-auto">{open ? <ChevronDown /> : <ChevronRight />}</span>
      </button>
      {open && (
        <div className="ps-toc px-1.5 pb-2">
          <div className="ps-toc-h">Scenarios</div>
          {manifest.scenarios.map((s) => (
            <button key={s.id} className="ps-toc-item" onClick={() => onJump(`scenario:${s.id}`)} title={s.label}>
              <span className="truncate">{s.label}</span>
              <span className="ps-toc-count">{s.steps.length}</span>
            </button>
          ))}
          <div className="ps-toc-h">Pages</div>
          {pages.map((p) => (
            <button key={p.id} className="ps-toc-item" onClick={() => onJump(`page:${p.id}`)} title={p.label}>
              <span className="truncate">{p.label}</span>
              <span className="ps-toc-count">{p.instances?.length ?? 0}</span>
            </button>
          ))}
          {(manifest.boards?.length ?? 0) > 0 && (
            <>
              <div className="ps-toc-h">Boards</div>
              {manifest.boards!.map((b) => (
                <button key={b.id} className="ps-toc-item" onClick={() => onJump(`board:${b.id}`)} title={b.title}>
                  <span className="truncate">{b.title}</span>
                </button>
              ))}
            </>
          )}
          {components.length > 0 && (
            <>
              <div className="ps-toc-h">Components</div>
              {components.map((p) => (
                <button key={p.id} className="ps-toc-item" onClick={() => onJump(`page:${p.id}`)} title={p.label}>
                  <span className="truncate">{p.label}</span>
                  <span className="ps-toc-count">{p.instances?.length ?? 0}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
