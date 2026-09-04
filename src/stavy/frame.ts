import { useEffect, useState } from "react"

/**
 * Everything the viewer knows about reaching into a prototype frame lives
 * here. The prototype renders in a same-origin <iframe>; the viewer never
 * imports it. Same-origin is the one requirement: it lets the overlays
 * hit-test, measure and read the frame's DOM (inspector, tours, pins,
 * comments) without a single line of code inside the prototype.
 */

export interface HostRect {
  left: number
  top: number
  width: number
  height: number
}

/** The frame's live document, or null while it is still `about:blank`, cross-origin, or unmounted. */
export function frameDoc(iframe: HTMLIFrameElement | null | undefined): Document | null {
  try {
    const d = iframe?.contentDocument ?? null
    if (!d || d.location.href === "about:blank") return null
    return d
  } catch {
    return null
  }
}

export function frameWin(iframe: HTMLIFrameElement | null | undefined): Window | null {
  try {
    return frameDoc(iframe) ? (iframe!.contentWindow ?? null) : null
  } catch {
    return null
  }
}

/** The frame's current URL (follows in-frame navigation), or null when unreadable. */
export function frameHref(iframe: HTMLIFrameElement | null | undefined): string | null {
  try {
    const href = iframe?.contentWindow?.location.href ?? null
    return href && href !== "about:blank" ? href : null
  } catch {
    return null
  }
}

/** Rendered scale of the frame: on the canvas the iframe is CSS-scaled, so 1 frame px ≠ 1 screen px. */
export function frameScale(iframe: HTMLIFrameElement): number {
  const w = iframe.offsetWidth
  return w ? iframe.getBoundingClientRect().width / w : 1
}

/** Rect of an element inside a frame, in the host viewport's coordinates (accounts for the frame's position and scale). */
export function hostRect(el: Element, iframe: HTMLIFrameElement): HostRect {
  const fr = iframe.getBoundingClientRect()
  const k = frameScale(iframe)
  const r = el.getBoundingClientRect()
  return { left: fr.left + r.left * k, top: fr.top + r.top * k, width: r.width * k, height: r.height * k }
}

/** Element inside the frame under a host-viewport point (what the overlays hit-test with). */
export function elementAt(iframe: HTMLIFrameElement, clientX: number, clientY: number): Element | null {
  const doc = frameDoc(iframe)
  if (!doc) return null
  const fr = iframe.getBoundingClientRect()
  const k = frameScale(iframe) || 1
  return doc.elementFromPoint((clientX - fr.left) / k, (clientY - fr.top) / k)
}

/**
 * The frame's document as React state: updates on every load (hard
 * navigation swaps the document) and is re-checked on an interval so a load
 * that fired before the listener attached is not missed.
 */
export function useFrameDocument(iframe: HTMLIFrameElement | null): Document | null {
  const [doc, setDoc] = useState<Document | null>(null)
  useEffect(() => {
    if (!iframe) {
      setDoc(null)
      return
    }
    const sync = () => setDoc(frameDoc(iframe))
    sync()
    iframe.addEventListener("load", sync)
    const t = setInterval(sync, 800)
    return () => {
      iframe.removeEventListener("load", sync)
      clearInterval(t)
    }
  }, [iframe])
  return doc
}

/**
 * Re-run `fn` (rAF-throttled) whenever anything that moves frame content on
 * screen changes: scrolling inside the frame (nested scrollers included),
 * frame or host resize, host scroll, and the frame element's own box.
 */
export function onFrameChange(iframe: HTMLIFrameElement, fn: () => void): () => void {
  const win = frameWin(iframe)
  let raf: number | null = null
  const schedule = () => {
    if (raf == null)
      raf = requestAnimationFrame(() => {
        raf = null
        fn()
      })
  }
  win?.addEventListener("scroll", schedule, { capture: true, passive: true })
  win?.addEventListener("resize", schedule)
  window.addEventListener("resize", schedule)
  window.addEventListener("scroll", schedule, { capture: true, passive: true })
  const ro = new ResizeObserver(schedule)
  ro.observe(iframe)
  return () => {
    win?.removeEventListener("scroll", schedule, true)
    win?.removeEventListener("resize", schedule)
    window.removeEventListener("resize", schedule)
    window.removeEventListener("scroll", schedule, true)
    ro.disconnect()
    if (raf != null) cancelAnimationFrame(raf)
  }
}

/* ---------------- wireframe: a stylesheet injected into the frame ---------------- */

const WIREFRAME_ID = "stavy-wireframe"
export const WIREFRAME_CSS = `html{filter:grayscale(1) contrast(.92) opacity(.96)!important;font-family:"Chalkboard SE","Comic Sans MS","Segoe Print",cursive!important}
html *,html *::before,html *::after{border-radius:2px!important;box-shadow:none!important;font-family:inherit!important}`

/** Wireframe rendering: token-driven colors go gray, shapes flatten, type goes sketchy. Toggled per frame document. */
export function setWireframe(doc: Document | null, on: boolean) {
  if (!doc?.head) return
  let st = doc.getElementById(WIREFRAME_ID) as HTMLStyleElement | null
  if (on && !st) {
    st = doc.createElement("style")
    st.id = WIREFRAME_ID
    st.textContent = WIREFRAME_CSS
    doc.head.appendChild(st)
  } else if (!on && st) st.remove()
}

/** Run `fn` with the wireframe filter temporarily lifted, so measured values describe the design, not the filter. */
export function withWireframeLifted<T>(doc: Document, fn: () => T): { value: T; lifted: boolean } {
  const st = doc.getElementById(WIREFRAME_ID) as HTMLStyleElement | null
  if (!st) return { value: fn(), lifted: false }
  st.disabled = true
  try {
    return { value: fn(), lifted: true }
  } finally {
    st.disabled = false
  }
}

/* ---------------- keyboard: the frame has focus most of the time ---------------- */

/**
 * Hotkeys are bound on the viewer window, but once the user clicks into the
 * prototype the frame's window owns the keyboard. Forward its key events to
 * the host window (skipping fields the user is typing in) so N/I/W/Esc/→
 * keep working. Consumers of the forwarded event see a normal KeyboardEvent.
 */
export function bridgeFrameKeys(doc: Document | null): () => void {
  if (!doc) return () => {}
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return
    const ev = new KeyboardEvent(e.type, e)
    const consumed = !window.dispatchEvent(ev)
    if (consumed) e.preventDefault()
  }
  doc.addEventListener("keydown", onKey)
  doc.addEventListener("keyup", onKey)
  return () => {
    doc.removeEventListener("keydown", onKey)
    doc.removeEventListener("keyup", onKey)
  }
}
