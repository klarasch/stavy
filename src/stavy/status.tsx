// Handover status: draft → review → ready (ready for development).
// One control for screens, states and boards. Read-only it is a chip; on the
// dev server it opens a small menu. "Ready" remembers each covered state's
// snapshot hash, so a later scan that changes the picture shows
// "Changed since ready".
import { useEffect, useRef, useState } from "react"
import { StavyLayer } from "./toplayer"
import { Check } from "./icons"
import { cn } from "./cn"
import { snapshotIndex } from "./manifest"
import { useSnapshotRev } from "./snapshots"
import type { ReadyMark } from "./types"

export const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "review", label: "In review" },
  { value: "ready", label: "Ready for dev" },
] as const

export function statusLabel(status: string): string {
  return STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status
}

/** State keys whose snapshot differs from the one recorded when marked ready (empty: unchanged, or no baseline). */
export function changedSinceReady(ready: ReadyMark | undefined): string[] {
  if (!ready?.snapshots) return []
  return Object.entries(ready.snapshots)
    .filter(([key, hash]) => {
      const now = snapshotIndex[key]?.hash
      return !!now && now !== hash
    })
    .map(([key]) => key)
}

/** Re-renders when the snapshot index changes, so the "changed" flag follows scans. */
export function useChangedSinceReady(ready: ReadyMark | undefined): string[] {
  useSnapshotRev()
  return changedSinceReady(ready)
}

function readyTitle(ready: ReadyMark | undefined, changed: number) {
  if (!ready) return "Ready for development"
  const who = ready.by ? ` by ${ready.by}` : ""
  const base = `Marked ready for development on ${ready.at}${who}`
  return changed ? `${base}. ${changed === 1 ? "Its snapshot has" : `${changed} snapshots have`} changed since.` : base
}

/**
 * The status chip. `onChange` (only on the dev server) makes it a menu;
 * "" clears the status. `placeholder` is shown when editable and unset.
 */
export function StatusControl({
  status,
  ready,
  onChange,
  sm = true,
  placeholder = "Set status",
}: {
  status?: string
  ready?: ReadyMark
  onChange?: (status: string) => void | Promise<void>
  sm?: boolean
  placeholder?: string
}) {
  // The menu lives in the Stavy top layer at the trigger's screen position, so
  // the canvas (zoom, cards painted later) can never cover it.
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const changed = useChangedSinceReady(status === "ready" ? ready : undefined).length

  useEffect(() => {
    if (!open) return
    const inside = (t: EventTarget | null) => !!t && (!!ref.current?.contains(t as Node) || !!menuRef.current?.contains(t as Node))
    const onDoc = (e: MouseEvent) => !inside(e.target) && setOpen(null)
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null)
    const close = () => setOpen(null)
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    window.addEventListener("wheel", close, { passive: true })
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("wheel", close)
    }
  }, [open])

  if (!status && !onChange) return null
  const title = status === "ready" ? readyTitle(ready, changed) : status ? `Status: ${statusLabel(status)}` : "Set a handover status"
  const chip = (
    <span className={cn("ps-chip ps-status", sm && "ps-chip-sm", status ? `ps-status-${status}` : "ps-status-none")}>
      <span className="ps-status-dot" />
      {status ? statusLabel(status) : placeholder}
    </span>
  )

  const pick = async (v: string) => {
    setOpen(null)
    if (!onChange || v === (status ?? "")) return
    setBusy(true)
    try {
      await onChange(v)
    } catch (e) {
      alert(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span
      ref={ref}
      className={cn("ps-status-control relative inline-flex items-center gap-1", busy && "opacity-60")}
      data-ps-ui
      // Editable: keep the click off the card or canvas behind. Read-only: let it through (a card link still opens).
      onClick={onChange ? (e) => e.stopPropagation() : undefined}
      onPointerDown={onChange ? (e) => e.stopPropagation() : undefined}
    >
      {onChange ? (
        <button type="button" className="ps-status-trigger" title={title} aria-haspopup="listbox" aria-expanded={!!open} onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setOpen((o) => (o ? null : { left: r.left, top: r.bottom + 6 }))
          }}>
          {chip}
        </button>
      ) : (
        <span title={title}>{chip}</span>
      )}
      {changed > 0 && (
        <span className="ps-chip ps-chip-sm ps-status-changed" title={title}>
          Changed since ready
        </span>
      )}
      {open && (
        <StavyLayer>
        <div ref={menuRef} role="listbox" className="ps ps-menu fixed z-50 min-w-40" style={{ left: open.left, top: open.top }} data-ps-ui onPointerDown={(e) => e.stopPropagation()}>
          {STATUS_OPTIONS.map((o) => (
            <button key={o.value} type="button" role="option" aria-selected={o.value === status} className="ps-menu-item" onClick={() => void pick(o.value)}>
              <span className={cn("ps-status-dot", `ps-status-${o.value}`)} />
              <span className="flex-1 text-left">{o.label}</span>
              {o.value === status && <Check className="size-3.5" style={{ color: "var(--ps-accent)" }} />}
            </button>
          ))}
          {status && (
            <button type="button" role="option" aria-selected={false} className="ps-menu-item" onClick={() => void pick("")}>
              <span className="flex-1 text-left" style={{ color: "var(--ps-muted)" }}>
                No status
              </span>
            </button>
          )}
        </div>
        </StavyLayer>
      )}
    </span>
  )
}
