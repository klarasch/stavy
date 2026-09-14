import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, ArrowRight, X, Check } from "../icons"
import { findTarget, getPage, pageUrl, resolveDims } from "../manifest"
import { PsButton, Chip, useHotkeys } from "../chrome"
import { StavyLayer } from "../toplayer"
import { frameDoc, hostRect, onFrameChange, type HostRect } from "../frame"
import type { Scenario } from "../types"

function sameRect(a: HostRect, b: HostRect) {
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

/** How long a target may stay missing before the "not found" banner shows — long
 *  enough that an ordinary step transition or a late-mounting widget never
 *  flashes it, short enough to still flag a genuinely wrong target. */
const MISSING_GRACE_MS = 2500

function stepUrl(scenario: Scenario, idx: number, carry?: Record<string, string>): string {
  const st = scenario.steps[idx]
  const page = getPage(st.page)
  const dims = page ? resolveDims(page, st.dims) : (st.dims ?? {})
  return pageUrl(st.page, dims, { tour: scenario.id, ts: String(idx), ...carry })
}

/**
 * Guided walkthrough over the player frame. The target lives inside the
 * prototype's document; its halo is measured in host viewport coordinates
 * and drawn in a fixed layer, tracking the frame's scroll and resize. The
 * step card sits in the Stavy top layer.
 */
export function TourOverlay({
  scenario,
  stepIdx,
  iframe,
  doc,
  exitUrl,
  carry,
}: {
  scenario: Scenario
  stepIdx: number
  iframe: HTMLIFrameElement | null
  /** The frame's current document (null while loading) */
  doc: Document | null
  exitUrl: string
  /** Viewer mode flags (w/a/i) to keep across tour steps. */
  carry?: Record<string, string>
}) {
  const navigate = useNavigate()
  const step = scenario.steps[stepIdx]
  const [rect, setRect] = useState<HostRect | null>(null)
  const [missing, setMissing] = useState(false)
  const isLast = stepIdx === scenario.steps.length - 1

  useEffect(() => {
    setRect(null)
    setMissing(false)
    if (!step?.target || !iframe) return

    let disposed = false
    let scrolled = false
    let observedDoc: Document | null = null
    let mo: MutationObserver | null = null
    let missTimer: ReturnType<typeof setTimeout> | null = null
    // Reset whenever the frame (re)loads, so a hard reload mid-step gets its
    // own grace period rather than inheriting one that already ran out.
    let activity = Date.now()

    const clearMissTimer = () => {
      if (missTimer != null) {
        clearTimeout(missTimer)
        missTimer = null
      }
    }
    const armMissTimer = () => {
      clearMissTimer()
      const wait = Math.max(0, MISSING_GRACE_MS - (Date.now() - activity))
      missTimer = setTimeout(() => {
        if (!disposed) setMissing(true)
      }, wait)
    }
    // Keep observing the frame's CURRENT document for the target mounting —
    // never a captured `doc`, which can lag a same-document (pushState) tour
    // navigation or point at a document a hard reload has since replaced.
    const observe = (d: Document) => {
      mo?.disconnect()
      mo = new MutationObserver(check)
      mo.observe(d.documentElement, { childList: true, subtree: true, attributes: true })
    }
    const check = () => {
      const d = frameDoc(iframe)
      if (!d) return
      if (d !== observedDoc) {
        observedDoc = d
        observe(d)
      }
      const el = findTarget(d, step.target!)
      if (!el) {
        setRect(null)
        armMissTimer()
        return
      }
      clearMissTimer()
      setMissing(false)
      if (!scrolled) {
        scrolled = true
        el.scrollIntoView({ block: "center", behavior: "smooth" })
      }
      const next = hostRect(el, iframe)
      setRect((prev) => (prev && sameRect(prev, next) ? prev : next))
    }

    check()
    const onLoad = () => {
      activity = Date.now()
      check()
    }
    iframe.addEventListener("load", onLoad)
    // …while scroll/resize (inside the frame and out) track continuously,
    // and act as a fallback poke for a target the MutationObserver missed.
    const off = onFrameChange(iframe, check)
    return () => {
      disposed = true
      clearMissTimer()
      mo?.disconnect()
      iframe.removeEventListener("load", onLoad)
      off()
    }
  }, [step, iframe, doc, stepIdx])

  // Clicking the highlighted element itself advances the tour.
  useEffect(() => {
    if (!step?.target || !iframe) return
    const onClick = (e: MouseEvent) => {
      const d = frameDoc(iframe)
      const el = d && findTarget(d, step.target!)
      if (el && e.target instanceof Node && el.contains(e.target)) {
        e.preventDefault()
        e.stopPropagation()
        navigate(isLast ? exitUrl : stepUrl(scenario, stepIdx + 1, carry))
      }
    }
    const d = frameDoc(iframe)
    d?.addEventListener("click", onClick, { capture: true })
    return () => d?.removeEventListener("click", onClick, { capture: true })
  }, [step, doc, iframe, scenario, stepIdx, isLast, exitUrl, carry, navigate])

  useHotkeys({
    ArrowRight: () => navigate(isLast ? exitUrl : stepUrl(scenario, stepIdx + 1, carry)),
    ArrowLeft: () => stepIdx > 0 && navigate(stepUrl(scenario, stepIdx - 1, carry)),
  })

  // Real card height for flip/clamp — a hardcoded estimate mispositions long step notes.
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(200)
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight
    if (h) setCardH(h)
  })

  if (!step) return null

  const pad = 6
  const GAP = 16
  const MARGIN = 16
  const CARD_W = 320 // w-80
  let cardStyle: CSSProperties
  if (rect) {
    const below = rect.top + rect.height + GAP
    const fitsBelow = below + cardH + MARGIN <= window.innerHeight
    cardStyle = {
      top: fitsBelow ? below : Math.max(MARGIN, rect.top - GAP - cardH),
      left: Math.max(MARGIN, Math.min(rect.left, window.innerWidth - CARD_W - MARGIN)),
    }
  } else {
    cardStyle = { bottom: 96, left: "50%", transform: "translateX(-50%)" }
  }

  return (
    <>
      {createPortal(
        <div className="ps-fixed-layer" data-ps-ui>
          {rect && (
            <div
              className="ps-halo transition-all duration-300"
              style={{ position: "absolute", top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
            />
          )}
        </div>,
        document.body
      )}
      <StavyLayer>
        <div ref={cardRef} className="ps ps-glass-strong fixed w-80 rounded-2xl p-4" style={cardStyle} data-ps-ui>
          <div className="flex items-center gap-2 mb-2.5">
            <Chip sm accent className="min-w-0 shrink" title={scenario.label}>
              <span className="truncate min-w-0">{scenario.label}</span>
            </Chip>
            <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums" style={{ color: "var(--ps-muted)" }}>
              {stepIdx + 1} / {scenario.steps.length}
            </span>
            <button className="ml-auto shrink-0 cursor-pointer transition-colors" style={{ color: "var(--ps-faint)" }} onClick={() => navigate(exitUrl)} title="Exit tour">
              <X className="size-4" />
            </button>
          </div>
          <div className="font-semibold text-[13.5px] mb-1">{step.title}</div>
          {step.note && (
            <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: "var(--ps-muted)" }}>
              {step.note}
            </p>
          )}
          {step.target && missing && (
            <p className="text-[11px] mb-3" style={{ color: "var(--ps-pin)" }}>
              Target <code className="ps-mono">{step.target}</code> not found on this screen.
            </p>
          )}
          <div className="flex items-center justify-between">
            <PsButton disabled={stepIdx === 0} onClick={() => navigate(stepUrl(scenario, stepIdx - 1, carry))}>
              <ArrowLeft /> Prev
            </PsButton>
            {isLast ? (
              <PsButton primary onClick={() => navigate(exitUrl)}>
                <Check /> Done
              </PsButton>
            ) : (
              <PsButton primary onClick={() => navigate(stepUrl(scenario, stepIdx + 1, carry))}>
                Next <ArrowRight />
              </PsButton>
            )}
          </div>
        </div>
      </StavyLayer>
    </>
  )
}

export { stepUrl }
