import { useState } from "react"
import { ChevronDown, ChevronRight, List } from "../icons"
import { groupPages, manifest, pageInWorkspace, scenarioInWorkspace } from "../manifest"
import { cn } from "../cn"

/** Table of contents for the canvas: jump to any scenario, page, or component. */
export function CanvasToc({
  onJump,
  className,
  wdims = {},
  showMap = true,
}: {
  onJump: (tocId: string) => void
  className?: string
  /** Active workspace assignment — the TOC lists only what the canvas shows */
  wdims?: Record<string, string>
  /** Whether the canvas is drawing the site map (`?map=0` hides it) */
  showMap?: boolean
}) {
  const [open, setOpen] = useState(true)
  const inScope = manifest.pages.filter((p) => pageInWorkspace(p, wdims))
  const pages = inScope.filter((p) => p.kind !== "component")
  const components = inScope.filter((p) => p.kind === "component")
  const scenarios = manifest.scenarios.filter((s) => scenarioInWorkspace(s, wdims))
  return (
    <div className={cn("ps ps-glass rounded-2xl", className)}>
      <button className="ps-btn w-full justify-start h-8 px-2.5 rounded-2xl" onClick={() => setOpen((o) => !o)}>
        <List />
        <span className="font-semibold" style={{ color: "var(--ps-fg)" }}>Contents</span>
        <span className="ml-auto">{open ? <ChevronDown /> : <ChevronRight />}</span>
      </button>
      {open && (
        <div className="ps-toc px-1.5 pb-2">
          {showMap && pages.length > 1 && (
            <button className="ps-toc-item" onClick={() => onJump("area:map")}>
              <span className="truncate">Site map</span>
              <span className="ps-toc-count">{pages.length}</span>
            </button>
          )}
          <div className="ps-toc-h">Scenarios</div>
          {scenarios.map((s) => (
            <button key={s.id} className="ps-toc-item" onClick={() => onJump(`scenario:${s.id}`)} title={s.label}>
              <span className="truncate">{s.label}</span>
              <span className="ps-toc-count">{s.steps.length}</span>
            </button>
          ))}
          {/* Sections (SPEC §1.3), in the same order the canvas lays them out. */}
          {groupPages(pages).map((section) => (
            <div key={section.group ?? " "}>
              <div className="ps-toc-h">{section.group ?? "Pages"}</div>
              {section.pages.map((p) => (
                <button key={p.id} className="ps-toc-item" onClick={() => onJump(`page:${p.id}`)} title={p.label}>
                  <span className="truncate">{p.label}</span>
                  <span className="ps-toc-count">{p.instances?.length ?? 1}</span>
                </button>
              ))}
            </div>
          ))}
          {((manifest.boards?.length ?? 0) > 0 || (manifest.requirements?.length ?? 0) > 0) && (
            <>
              <div className="ps-toc-h">Boards</div>
              {(manifest.requirements?.length ?? 0) > 0 && (
                <button className="ps-toc-item" onClick={() => onJump("board:coverage")}>
                  <span className="truncate">Requirement coverage</span>
                </button>
              )}
              {(manifest.boards ?? []).map((b) => (
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
                  <span className="ps-toc-count">{p.instances?.length ?? 1}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
