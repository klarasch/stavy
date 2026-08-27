import { useEffect, useRef, useState } from "react"
import { StavyLayer } from "./toplayer"
import { TriangleAlert, X } from "./icons"

/**
 * Dev-only adoption diagnostics. The two silent killers of a Stavy adoption
 * are overlays that escape containment (a kit modal portalled to
 * `document.body` lands at the document root, full-viewport, covering the
 * whole canvas) and kit scroll locks (react-remove-scroll, MUI ScrollLock)
 * that block canvas panning from inside a correctly contained modal. Both
 * fail without saying why. This module turns them into named warnings — a
 * dismissible chrome card plus a `console.warn` with the fix — so the person
 * (or agent) wiring a page learns the contract from the failure itself.
 *
 * Detection only, never repair: adopting an escaped portal node into the card
 * (or reverting a lock the kit will restore) desyncs React from the document.
 * The fix belongs in the page — see SKILL.md "Modals and overlays".
 */

interface Diag {
  key: string
  title: string
  detail: string
  fix: string
}

/* Body-level intrusions are attributed via React fibers: the escaped node's
 * fiber `return` chain crosses the portal back to whoever rendered it; if a
 * `PageRenderer` frame is on that chain, a prototype page is the offender.
 * Un-attributable nodes (host-app chrome opening its own portals while the
 * viewer is mounted at a sub-path) are deliberately ignored — only pages are
 * held to the containment contract. */
function fiberOf(el: Element): any {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))
  return key ? (el as any)[key] : null
}

function owningPageId(node: Element): string | null {
  let f = fiberOf(node)
  if (!f) for (const el of node.querySelectorAll("*")) if ((f = fiberOf(el))) break
  for (; f; f = f.return) {
    const name = typeof f.type === "function" ? f.type.displayName || f.type.name : null
    if (name === "PageRenderer" && typeof f.memoizedProps?.pageId === "string") return f.memoizedProps.pageId
  }
  return null
}

/** Viewer-owned body-level roots and dev tooling — never intrusions. */
function isOwnChrome(el: Element): boolean {
  return (
    el.hasAttribute("data-ps-ui") ||
    el.classList.contains("ps-toplayer") ||
    el.classList.contains("ps") ||
    /^(SCRIPT|STYLE|LINK|TEMPLATE|VITE-ERROR-OVERLAY)$/.test(el.tagName)
  )
}

export function StavyDiagnostics() {
  const [diags, setDiags] = useState<Diag[]>([])
  // Session-sticky: a dismissed or already-reported key never re-warns, even
  // when the same modal state remounts on every canvas pass.
  const seen = useRef(new Set<string>())

  const add = (d: Diag) => {
    if (seen.current.has(d.key)) return
    seen.current.add(d.key)
    console.warn(`[stavy] ${d.title}\n${d.detail}\nFix: ${d.fix}`)
    setDiags((prev) => [...prev, d])
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return

    const portals = new MutationObserver((muts) => {
      for (const m of muts)
        for (const node of m.addedNodes) {
          if (!(node instanceof Element) || isOwnChrome(node)) continue
          const pageId = owningPageId(node)
          if (!pageId) continue
          add({
            key: `portal:${pageId}`,
            title: "Overlay escaped to document.body",
            detail: `Page "${pageId}" portalled an overlay to the document root — it escapes the card's scale and clip and will cover the canvas.`,
            fix: `pass useStavyPortalContainer() to the kit's escape hatch (MUI \`container\`, Radix \`<Portal container>\`, Ant \`getContainer\`) — see SKILL.md "Modals and overlays".`,
          })
        }
    })
    portals.observe(document.body, { childList: true })

    // Scroll locks set `overflow: hidden` inline on <body>. The warning is
    // live rather than sticky-visible: it clears itself when the lock lifts
    // (a host-app modal restoring on close) and stays up while a pinned
    // prototype modal holds the lock — which is exactly the broken case.
    const lockKey = "scroll-lock"
    const locks = new MutationObserver(() => {
      const locked = document.body.style.overflow === "hidden"
      if (locked)
        add({
          key: lockKey,
          title: "A scroll lock is holding <body>",
          detail: "Something set `overflow: hidden` on <body> — kit modals do this via their scroll lock, and it blocks canvas panning even when the modal is contained in its card.",
          fix: "disable the kit's scroll lock when wiring prototype modals: MUI `disableScrollLock`, Radix `<Dialog modal={false}>`, or the kit's equivalent.",
        })
      else {
        seen.current.delete(lockKey)
        setDiags((prev) => prev.filter((d) => d.key !== lockKey))
      }
    })
    locks.observe(document.body, { attributes: true, attributeFilter: ["style"] })

    return () => {
      portals.disconnect()
      locks.disconnect()
    }
  }, [])

  if (!diags.length) return null
  return (
    <StavyLayer>
      <div className="ps ps-diags" data-ps-ui>
        {diags.map((d) => (
          <div key={d.key} className="ps-glass-strong ps-diag">
            <TriangleAlert className="ps-diag-icon" />
            <div className="ps-diag-body">
              <div className="ps-diag-title">{d.title}</div>
              <div className="ps-diag-detail">
                {d.detail} <span className="ps-diag-fix">Fix: {d.fix}</span>
              </div>
            </div>
            <button
              className="ps-diag-close"
              onClick={() => setDiags((prev) => prev.filter((x) => x.key !== d.key))}
              title="Dismiss"
            >
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        ))}
      </div>
    </StavyLayer>
  )
}
