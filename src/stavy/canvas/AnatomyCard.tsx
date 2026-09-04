import { memo, useState } from "react"
import { resolveDims, snapshotEntry, snapshotUrl } from "../manifest"
import { VIEWPORT_W, VIEWPORT_H } from "./InstanceCard"
import type { PageDef } from "../types"

/**
 * Design anatomy: the page's snapshot with its *annotations* drawn as
 * numbered callouts and a legend of what each part does — for PMs, designers
 * and engineers alike. Boxes come from the snapshot index (measured by
 * `scripts/scan.mjs`), so this costs nothing at view time. (Which components
 * implement a part is the inspector's job, not this card's.)
 */
export const AnatomyCard = memo(function AnatomyCard({
  page,
  scale = 0.3,
  overrides,
}: {
  page: PageDef
  scale?: number
  /** Dimension values to force (the active workspace assignment, SPEC §1.1) */
  overrides?: Record<string, string>
}) {
  const annotations = page.annotations ?? []
  const dims = resolveDims(page, { ...page.instances?.[0]?.dims, ...overrides })
  const FW = page.frame?.width ?? VIEWPORT_W
  const FH = page.frame?.height ?? VIEWPORT_H
  const w = Math.round(FW * scale)
  const h = Math.round(FH * scale)
  const entry = snapshotEntry(page, dims)
  const [snapErr, setSnapErr] = useState(false)
  if (!annotations.length) return null

  const callouts = annotations.flatMap((a, i) => {
    const b = entry?.targets[a.target]
    return b ? [{ n: i + 1, left: b.x * 100, top: b.y * 100, width: b.w * 100, height: b.h * 100 }] : []
  })

  return (
    <div className="ps flex items-start gap-6" data-ps-ui>
      <div className="ps-card-frame relative rounded-lg bg-white overflow-hidden shrink-0" style={{ width: w, height: h }}>
        <div className="absolute inset-0 flex items-center justify-center text-[11px] font-medium" style={{ color: "var(--ps-faint)" }}>
          {page.label}
        </div>
        {!snapErr && <img className="ps-card-img" src={snapshotUrl(page, dims)} alt="" draggable={false} onError={() => setSnapErr(true)} />}
        {callouts.map((c) => (
          <div key={c.n}>
            <div className="ps-anat-box" style={{ left: `${c.left}%`, top: `${c.top}%`, width: `${c.width}%`, height: `${c.height}%` }} />
            <div className="ps-anat-tag" style={{ left: `${c.left}%`, top: `${c.top}%` }}>{c.n}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2.5 pt-1" style={{ width: 300 }}>
        {annotations.map((a, i) => (
          <div key={a.target} className="flex items-start gap-2.5">
            <span className="ps-anat-tag" style={{ position: "static", transform: "none", flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
            <div>
              <div className="text-[12.5px] font-semibold leading-tight">{a.title}</div>
              <div className="ps-sub leading-snug mt-0.5">{a.note}</div>
            </div>
          </div>
        ))}
        {!entry && (
          <div className="ps-sub mt-1" style={{ color: "var(--ps-pin)" }}>
            No snapshot yet — run <code className="ps-mono">npm run scan</code> to place the callouts.
          </div>
        )}
      </div>
    </div>
  )
})
