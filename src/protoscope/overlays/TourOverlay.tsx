import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, ArrowRight, X, Check } from "lucide-react"
import { findProtoTarget } from "../proto"
import { getPage, pageUrl, resolveDims } from "../manifest"
import { PsButton, Chip, useHotkeys } from "../chrome"
import type { Scenario } from "../types"

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function stepUrl(scenario: Scenario, idx: number): string {
  const st = scenario.steps[idx]
  const page = getPage(st.page)
  const dims = page ? resolveDims(page, st.dims) : (st.dims ?? {})
  return pageUrl(st.page, dims, { tour: scenario.id, ts: String(idx) })
}

export function TourOverlay({
  scenario,
  stepIdx,
  wrapper,
  exitUrl,
}: {
  scenario: Scenario
  stepIdx: number
  wrapper: HTMLElement
  exitUrl: string
}) {
  const navigate = useNavigate()
  const step = scenario.steps[stepIdx]
  const [rect, setRect] = useState<Rect | null>(null)
  const isLast = stepIdx === scenario.steps.length - 1

  useEffect(() => {
    setRect(null)
    if (!step?.target) return
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    let scrolled = false
    const measure = () => {
      const el = findProtoTarget(wrapper, step.target!)
      if (el) {
        if (!scrolled) {
          scrolled = true
          el.scrollIntoView({ block: "center", behavior: "smooth" })
        }
        const w = wrapper.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        setRect({
          top: r.top - w.top + wrapper.scrollTop,
          left: r.left - w.left + wrapper.scrollLeft,
          width: r.width,
          height: r.height,
        })
      }
      if (tries++ < 30) timer = setTimeout(measure, el ? 400 : 120)
    }
    measure()
    window.addEventListener("resize", measure)
    return () => {
      clearTimeout(timer)
      window.removeEventListener("resize", measure)
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
        navigate(isLast ? exitUrl : stepUrl(scenario, stepIdx + 1))
      }
    }
    wrapper.addEventListener("click", onClick, { capture: true })
    return () => wrapper.removeEventListener("click", onClick, { capture: true })
  }, [step, wrapper, scenario, stepIdx, isLast, exitUrl, navigate])

  useHotkeys({
    ArrowRight: () => navigate(isLast ? exitUrl : stepUrl(scenario, stepIdx + 1)),
    ArrowLeft: () => stepIdx > 0 && navigate(stepUrl(scenario, stepIdx - 1)),
  })

  if (!step) return null

  const pad = 6
  const CARD_ESTIMATE = 200
  const flipAbove =
    rect !== null &&
    rect.top + rect.height + 16 + CARD_ESTIMATE > wrapper.scrollTop + wrapper.clientHeight - 90

  return (
    <div className="absolute inset-0 pointer-events-none z-40" data-ps-ui>
      {rect && (
        <div
          className="ps-halo transition-all duration-300"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
          }}
        />
      )}
      <div
        className="ps ps-glass-strong absolute pointer-events-auto w-80 rounded-2xl p-4"
        style={
          rect
            ? {
                top: flipAbove ? rect.top - 16 : rect.top + rect.height + 16,
                transform: flipAbove ? "translateY(-100%)" : undefined,
                left: Math.max(16, Math.min(rect.left, wrapper.clientWidth - 340)),
              }
            : { bottom: 96, left: "50%", transform: "translateX(-50%)" }
        }
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
          <PsButton disabled={stepIdx === 0} onClick={() => navigate(stepUrl(scenario, stepIdx - 1))}>
            <ArrowLeft /> Prev
          </PsButton>
          {isLast ? (
            <PsButton primary onClick={() => navigate(exitUrl)}>
              <Check /> Done
            </PsButton>
          ) : (
            <PsButton primary onClick={() => navigate(stepUrl(scenario, stepIdx + 1))}>
              Next <ArrowRight />
            </PsButton>
          )}
        </div>
      </div>
    </div>
  )
}

export { stepUrl }
