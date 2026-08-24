import { useNavigate } from "react-router-dom"
import { CheckCircle2, CircleDashed, Play } from "../icons"
import { manifest, getPage } from "../manifest"
import { stepUrl } from "../overlays/TourOverlay"
import { Chip } from "../chrome"

/**
 * Requirements → scenarios → states. The PM's view of the contract: every
 * requirement either has walkthroughs that demonstrate it (click to play) or is
 * an explicit gap. Data comes from the manifest only; the PRD document itself is
 * cross-checked by `npm run check --refs`.
 */
export function CoverageBoard({ wireframe }: { wireframe?: boolean }) {
  const navigate = useNavigate()
  const carry = wireframe ? { w: "1" } : undefined
  const reqs = manifest.requirements ?? []
  if (!reqs.length) return null
  const byRef = new Map<string, typeof manifest.scenarios>()
  for (const sc of manifest.scenarios) for (const r of sc.refs ?? []) byRef.set(r, [...(byRef.get(r) ?? []), sc])
  const covered = reqs.filter((r) => (byRef.get(r.id)?.length ?? 0) > 0).length
  const uncited = manifest.scenarios.filter((s) => !(s.refs ?? []).some((r) => reqs.some((q) => q.id === r)))

  return (
    <div className="ps ps-board" data-ps-ui style={{ width: 760 }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="ps-h3">Requirement coverage</span>
        <Chip sm accent={covered === reqs.length}>
          {covered} / {reqs.length} demonstrated
        </Chip>
        {uncited.length > 0 && <Chip sm>{uncited.length} scenario(s) cite nothing</Chip>}
      </div>
      <div className="flex flex-col" style={{ borderTop: "1px solid var(--ps-border)" }}>
        {reqs.map((r) => {
          const scs = byRef.get(r.id) ?? []
          const gap = scs.length === 0
          return (
            <div key={r.id} className="flex items-start gap-3 py-2.5" style={{ borderBottom: "1px solid var(--ps-border)" }}>
              {gap ? (
                <CircleDashed className="size-4 mt-0.5 shrink-0" style={{ color: "var(--ps-pin)" }} />
              ) : (
                <CheckCircle2 className="size-4 mt-0.5 shrink-0" style={{ color: "var(--ps-comment)" }} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="ps-mono text-[11.5px]">{r.id}</span>
                  <span className="text-[12.5px] font-medium truncate">{r.title}</span>
                  {r.priority && <Chip sm className="ml-auto shrink-0">{r.priority}</Chip>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {gap ? (
                    <span className="text-[11.5px]" style={{ color: "var(--ps-pin-fg)", background: "var(--ps-pin)", borderRadius: 6, padding: "1px 7px" }}>
                      gap — no scenario demonstrates this
                    </span>
                  ) : (
                    scs.map((sc) => {
                      const first = sc.steps[0]
                      const page = getPage(first.page)
                      const pages = new Set(sc.steps.map((st) => st.page)).size
                      return (
                        <button
                          key={sc.id}
                          className="ps-chip ps-chip-sm cursor-pointer"
                          title={`Play "${sc.label}" (${sc.steps.length} steps across ${pages} page${pages === 1 ? "" : "s"})`}
                          onClick={() => page && navigate(stepUrl(sc, 0, carry))}
                        >
                          <Play className="size-3" /> {sc.label}
                          <span className="ps-chip-k">{sc.steps.length} steps</span>
                        </button>
                      )
                    })
                  )}
                  {r.source && <span className="ps-sub text-[10.5px] ml-auto truncate" style={{ maxWidth: 220 }}>{r.source}</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {uncited.length > 0 && (
        <div className="ps-sub mt-2.5 text-[11px]">
          Not tied to a requirement:{" "}
          {uncited.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              <button className="underline cursor-pointer" onClick={() => navigate(stepUrl(s, 0, carry))}>
                {s.label}
              </button>
            </span>
          ))}
          {" "}— add `refs`, or it's scope creep.
        </div>
      )}
      <div className="ps-sub mt-2 text-[11px]">
        Run <code className="ps-mono">npm run check --refs docs/PRD.md</code> to cross-check the PRD text itself.
      </div>
    </div>
  )
}
