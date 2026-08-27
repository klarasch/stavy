import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, ArrowRight, X, Check } from "../icons"
import { findProtoTarget } from "../proto"
import { getPage, pageUrl, resolveDims } from "../manifest"
import { PsButton, Chip, useHotkeys } from "../chrome"
import { StavyLayer } from "../toplayer"
import type { Scenario } from "../types"

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

/**
 * The target is tracked in two coordinate spaces at once: the halo lives in
 * the page wrapper (it highlights content, so it must scroll and clip with
 * it), while the step card renders in the Stavy top layer with viewport
 * coordinates — host pages have nested `overflow: hidden` scrollers, and a
 * card positioned inside them clips whenever the target sits near an edge.
 */
interface Measured {
  vp: Rect
  local: Rect
}

function sameRect(a: Rect, b: Rect) {
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

function stepUrl(scenario: Scenario, idx: number, carry?: Record<string, string>): string {
  const st = scenario.steps[idx]
  const page = getPage(st.page)
  const dims = page ? resolveDims(page, st.dims) : (st.dims ?? {})
  return pageUrl(st.page, dims, { tour: scenario.id, ts: String(idx), ...carry })
}

export function TourOverlay({
  scenario,
  stepIdx,
  wrapper,
  exitUrl,
  carry,
}: {
  scenario: Scenario
  stepIdx: number
  wrapper: HTMLElement
  exitUrl: string
  /** Viewer mode flags (w/a/i) to keep across tour steps. */
  carry?: Record<string, string>
}) {
  const navigate = useNavigate()
  const step = scenario.steps[stepIdx]
  const [rect, setRect] = useState<Measured | null>(null)
  const isLast = stepIdx === scenario.steps.length - 1

  useEffect(() => {
    setRect(null)
    if (!step?.target) return
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    let raf: number | null = null
    let scrolled = false
    const measure = () => {
      const el = findProtoTarget(wrapper, step.target!)
      if (!el) return false
      if (!scrolled) {
        scrolled = true
        el.scrollIntoView({ block: "center", behavior: "smooth" })
      }
      const w = wrapper.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const next: Measured = {
        vp: { top: r.top, left: r.left, width: r.width, height: r.height },
        local: {
          top: r.top - w.top + wrapper.scrollTop,
          left: r.left - w.left + wrapper.scrollLeft,
          width: r.width,
          height: r.height,
        },
      }
      setRect((prev) => (prev && sameRect(prev.vp, next.vp) && sameRect(prev.local, next.local) ? prev : next))
      return true
    }
    // Retry loop handles late-mounting targets and layout settling…
    const retry = () => {
      const found = measure()
      if (tries++ < 30) timer = setTimeout(retry, found ? 400 : 120)
    }
    // …while scroll/resize track continuously (capture catches nested
    // scrollers), rAF-throttled. The card is viewport-positioned, so it must
    // follow every scroll of the page, not just the settle loop.
    const schedule = () => {
      if (raf == null)
        raf = requestAnimationFrame(() => {
          raf = null
          measure()
        })
    }
    retry()
    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, { capture: true, passive: true })
    return () => {
      clearTimeout(timer)
      if (raf != null) cancelAnimationFrame(raf)
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule, true)
    }
  }, [step, wrapper, stepIdx])

  // Clicking the highlighted element itself advances the tour.
  useEffect(() => {
    if (!step?.target) return
    const onClick = (e: MouseEvent) => {
      const el = findProtoTarget(wrapper, step.target!)
      if (el && e.target instanceof Node && el.contains(e.target)) {
        e.preventDefault()
        e.stopPropagation()
        navigate(isLast ? exitUrl : stepUrl(scenario, stepIdx + 1, carry))
      }
    }
    wrapper.addEventListener("click", onClick, { capture: true })
    return () => wrapper.removeEventListener("click", onClick, { capture: true })
  }, [step, wrapper, scenario, stepIdx, isLast, exitUrl, carry, navigate])

  useHotkeys({
    ArrowRight: () => navigate(isLast ? exitUrl : stepUrl(scenario, stepIdx + 1, carry)),
    ArrowLeft: () => stepIdx > 0 && navigate(stepUrl(scenario, stepIdx - 1, carry)),
  })

  // Real card height for flip/clamp — the old hardcoded estimate mispositioned
  // long step notes. Runs every render; setState bails when unchanged.
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
    const below = rect.vp.top + rect.vp.height + GAP
    const fitsBelow = below + cardH + MARGIN <= window.innerHeight
    cardStyle = {
      top: fitsBelow ? below : Math.max(MARGIN, rect.vp.top - GAP - cardH),
      left: Math.max(MARGIN, Math.min(rect.vp.left, window.innerWidth - CARD_W - MARGIN)),
    }
  } else {
    cardStyle = { bottom: 96, left: "50%", transform: "translateX(-50%)" }
  }

  return (
    <div className="absolute inset-0 pointer-events-none z-40" data-ps-ui>
      {rect && (
        <div
          className="ps-halo transition-all duration-300"
          style={{
            top: rect.local.top - pad,
            left: rect.local.left - pad,
            width: rect.local.width + pad * 2,
            height: rect.local.height + pad * 2,
          }}
        />
      )}
      <StavyLayer>
      <div
        ref={cardRef}
        className="ps ps-glass-strong fixed w-80 rounded-2xl p-4"
        style={cardStyle}
      >
        <div className="flex items-center gap-2 mb-2.5">
          <Chip sm accent>{scenario.label}</Chip>
          <span className="text-[11px] tabular-nums" style={{ color: "var(--ps-muted)" }}>
            {stepIdx + 1} / {scenario.steps.length}
          </span>
          <button
            className="ml-auto cursor-pointer transition-colors"
            style={{ color: "var(--ps-faint)" }}
            onClick={() => navigate(exitUrl)}
            title="Exit tour"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="font-semibold text-[13.5px] mb-1">{step.title}</div>
        {step.note && (
          <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: "var(--ps-muted)" }}>
            {step.note}
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
    </div>
  )
}

export { stepUrl }
