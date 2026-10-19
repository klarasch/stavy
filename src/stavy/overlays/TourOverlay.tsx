import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, ArrowRight, X, Check } from "../icons"
import { findTarget, getPage, pageUrl, resolveDims, matchAppUrl, dimsEqual } from "../manifest"
import { PsButton, Chip, useHotkeys } from "../chrome"
import { StavyLayer } from "../toplayer"
import { frameDoc, frameHref, hostRect, onFrameChange, type HostRect } from "../frame"
import type { Scenario, ScenarioStep } from "../types"

function sameRect(a: HostRect, b: HostRect) {
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

/** How long a target may stay missing before the "not found" banner shows — long
 *  enough that an ordinary step transition or a late-mounting widget never
 *  flashes it, short enough to still flag a genuinely wrong target. */
const MISSING_GRACE_MS = 2500

/** After the app got the click: how long the next step may take to show up before we navigate to it. */
const ADVANCE_WAIT_MS = 1500
const ADVANCE_POLL_MS = 50

/** Diagnostics ("target not found") are for authors: `?debug=1` shows them, viewers get the step as a plain card. */
const debugOn = () => {
  try {
    return new URLSearchParams(window.location.search).get("debug") === "1"
  } catch {
    return false
  }
}

const CLICKABLE = "a,button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],[tabindex]"
function isClickable(el: Element): boolean {
  if (el.closest(CLICKABLE)) return true
  try {
    return (el.ownerDocument.defaultView?.getComputedStyle(el).cursor ?? "") === "pointer"
  } catch {
    return false
  }
}

/** Is the frame already showing what `next` asks for: its target is there, or the frame is at its state. */
function stepSatisfied(iframe: HTMLIFrameElement, next: ScenarioStep): boolean {
  const d = frameDoc(iframe)
  if (!d) return false
  if (next.target && findTarget(d, next.target)) return true
  const href = frameHref(iframe)
  const m = href ? matchAppUrl(href) : null
  const np = getPage(next.page)
  return !!(m && np && m.page.id === np.id && dimsEqual(m.dims, resolveDims(np, next.dims)))
}

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
  onAdvanceInPlace,
  onExitInPlace,
}: {
  scenario: Scenario
  stepIdx: number
  iframe: HTMLIFrameElement | null
  /** The frame's current document (null while loading) */
  doc: Document | null
  exitUrl: string
  /** Viewer mode flags (w/a/i) to keep across tour steps. */
  carry?: Record<string, string>
  /** Move to step `idx` by changing only the viewer URL — the frame stays exactly as the app left it. */
  onAdvanceInPlace?: (idx: number) => void
  /** Leave the tour without touching the frame. */
  onExitInPlace?: () => void
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
        if (disposed) return
        setMissing(true)
        console.info(`[stavy] tour "${scenario.id}" step ${stepIdx + 1}: target "${step.target}" not found in the frame after ${MISSING_GRACE_MS} ms; showing the step without a highlight.`)
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

  // The app gets every click. When the highlighted element is clicked (by the
  // viewer or by the reviewer) we let it through, then wait for the app to
  // reach what the next step needs; only if it never does, navigate there.
  const pendingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastPress = useRef(0)
  const cancelPending = () => {
    if (pendingRef.current != null) clearInterval(pendingRef.current)
    pendingRef.current = null
  }
  useEffect(() => cancelPending, [stepIdx, iframe])

  const goNext = () => navigate(isLast ? exitUrl : stepUrl(scenario, stepIdx + 1, carry))

  /** The app has just received the click on this step's target. */
  const afterTargetClick = () => {
    if (pendingRef.current != null || !iframe) return
    if (isLast) {
      // Nothing more to wait for: leave the tour with the app as the click left it.
      pendingRef.current = setInterval(() => {
        cancelPending()
        if (onExitInPlace) onExitInPlace()
        else navigate(exitUrl)
      }, 300)
      return
    }
    const next = scenario.steps[stepIdx + 1]
    const started = Date.now()
    pendingRef.current = setInterval(() => {
      if (stepSatisfied(iframe, next)) {
        cancelPending()
        if (onAdvanceInPlace) onAdvanceInPlace(stepIdx + 1)
        else goNext()
      } else if (Date.now() - started >= ADVANCE_WAIT_MS) {
        cancelPending()
        goNext()
      }
    }, ADVANCE_POLL_MS)
  }

  useEffect(() => {
    if (!step?.target || !iframe) return
    // Menus (Radix Select, dropdowns) open on pointerdown and swallow the
    // click that follows, so the press counts as the interaction; the click
    // covers keyboard activation and the viewer's own Next.
    const onPress = (e: Event) => {
      const d = frameDoc(iframe)
      const el = d && findTarget(d, step.target!)
      // (no `instanceof Node`: the target belongs to the frame's realm, not ours)
      if (!el || !e.target || !el.contains(e.target as Node)) return
      if (e.type === "pointerdown") {
        if ((e as PointerEvent).button !== 0) return
        lastPress.current = Date.now()
      } else if (Date.now() - lastPress.current < 1000) return
      afterTargetClick()
    }
    const d = frameDoc(iframe)
    d?.addEventListener("pointerdown", onPress, { capture: true })
    d?.addEventListener("click", onPress, { capture: true })
    return () => {
      d?.removeEventListener("pointerdown", onPress, { capture: true })
      d?.removeEventListener("click", onPress, { capture: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, doc, iframe, scenario, stepIdx, isLast, exitUrl, carry, navigate, onAdvanceInPlace, onExitInPlace])

  /** Next / →: do what a reviewer would do — click the target — or just move on when there is nothing to click. */
  const advance = () => {
    if (pendingRef.current != null) return
    const d = iframe && frameDoc(iframe)
    const el = step?.target && d ? findTarget(d, step.target) : null
    if (el && isClickable(el)) {
      ;(el as HTMLElement).click()
      return
    }
    // Nothing to click. Stay put when the next step is already on screen.
    const next = scenario.steps[stepIdx + 1]
    if (!isLast && iframe && next && stepSatisfied(iframe, next) && onAdvanceInPlace) onAdvanceInPlace(stepIdx + 1)
    else goNext()
  }

  useHotkeys({
    ArrowRight: advance,
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
  } else if (!step.target || missing) {
    // No target, or none to be found: the step is a plain centred card.
    cardStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
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
          <button className="absolute top-3 right-3 cursor-pointer transition-colors" style={{ color: "var(--ps-faint)" }} onClick={() => navigate(exitUrl)} title="Exit tour">
            <X className="size-4" />
          </button>
          <div className="flex items-center gap-2 mb-2.5 pr-7">
            <Chip sm accent className="min-w-0 shrink" title={scenario.label}>
              <span className="truncate min-w-0">{scenario.label}</span>
            </Chip>
            <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums" style={{ color: "var(--ps-muted)" }}>
              {stepIdx + 1} / {scenario.steps.length}
            </span>
          </div>
          <div className="font-semibold text-[13.5px] mb-1">{step.title}</div>
          {step.note && (
            <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: "var(--ps-muted)" }}>
              {step.note}
            </p>
          )}
          {step.target && missing && debugOn() && (
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
              <PsButton primary onClick={advance}>
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
