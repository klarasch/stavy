/**
 * What assistive technology would make of an element, as far as the DOM says:
 * its role (explicit, or the tag's implicit one), an approximate accessible
 * name, its ARIA state and whether it takes focus. An approximation of the
 * accname algorithm, good enough to spot a nameless icon button — not a
 * replacement for an accessibility audit.
 */

export interface A11yRow {
  k: string
  v: string
  note?: string
}

function implicitRole(el: Element): string | null {
  const tag = el.tagName.toLowerCase()
  switch (tag) {
    case "button":
      return "button"
    case "a":
      return el.hasAttribute("href") ? "link" : null
    case "input": {
      const type = (el.getAttribute("type") ?? "text").toLowerCase()
      if (["button", "submit", "reset", "image"].includes(type)) return "button"
      if (type === "checkbox") return "checkbox"
      if (type === "radio") return "radio"
      if (type === "range") return "slider"
      if (type === "search") return "searchbox"
      if (type === "hidden") return null
      return "textbox"
    }
    case "select":
      return el.hasAttribute("multiple") ? "listbox" : "combobox"
    case "textarea":
      return "textbox"
    case "img":
      return el.getAttribute("alt") === "" ? "presentation" : "img"
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
      return "heading"
    case "nav":
      return "navigation"
    case "main":
      return "main"
    case "header":
      return "banner"
    case "footer":
      return "contentinfo"
    case "aside":
      return "complementary"
    case "ul": case "ol":
      return "list"
    case "li":
      return "listitem"
    case "table":
      return "table"
    case "tr":
      return "row"
    case "td":
      return "cell"
    case "th":
      return el.closest("thead") ? "columnheader" : "rowheader"
    case "form":
      return "form"
    case "dialog":
      return "dialog"
    case "section":
      return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "region" : null
    default:
      return null
  }
}

const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()

/** An approximate accessible name and where it came from. */
function accessibleName(el: Element): { name: string; from: string } | null {
  const doc = el.ownerDocument
  const label = squash(el.getAttribute("aria-label"))
  if (label) return { name: label, from: "aria-label" }
  const by = el.getAttribute("aria-labelledby")
  if (by) {
    const text = squash(by.split(/\s+/).map((id) => doc.getElementById(id)?.textContent ?? "").join(" "))
    if (text) return { name: text, from: "aria-labelledby" }
  }
  const tag = el.tagName.toLowerCase()
  if (tag === "img") {
    const alt = el.getAttribute("alt")
    if (alt !== null) return { name: squash(alt), from: "alt" }
  }
  if (tag === "input" || tag === "select" || tag === "textarea") {
    const id = el.getAttribute("id")
    const lbl = (id && doc.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest("label")
    if (lbl) return { name: squash(lbl.textContent), from: "label" }
    const ph = squash(el.getAttribute("placeholder"))
    if (ph) return { name: ph, from: "placeholder (not a label)" }
  }
  const title = squash(el.getAttribute("title"))
  const text = squash(el.textContent)
  if (text && text.length <= 120) return { name: text, from: "content" }
  if (title) return { name: title, from: "title" }
  return null
}

const NAME_REQUIRED = new Set(["button", "link", "checkbox", "radio", "textbox", "combobox", "searchbox", "slider", "img", "dialog"])

export function a11yRows(el: Element): A11yRow[] {
  const explicit = el.getAttribute("role")
  const role = explicit ?? implicitRole(el)
  const rows: A11yRow[] = [{ k: "role", v: role ?? "none", note: explicit ? "explicit" : role ? "implicit" : undefined }]
  if (role === "heading") {
    const level = el.getAttribute("aria-level") ?? el.tagName.match(/^H(\d)$/i)?.[1]
    if (level) rows.push({ k: "level", v: level })
  }
  const name = accessibleName(el)
  if (name) rows.push({ k: "name", v: name.name || "—", note: name.from })
  else if (role && NAME_REQUIRED.has(role)) rows.push({ k: "name", v: "missing", note: `a ${role} needs an accessible name` })
  for (const a of Array.from(el.attributes)) {
    if (a.name.startsWith("aria-") && a.name !== "aria-label" && a.name !== "aria-labelledby") rows.push({ k: a.name, v: a.value || "—" })
  }
  const h = el as HTMLElement
  const focusable = typeof h.tabIndex === "number" && h.tabIndex >= 0 && !h.hasAttribute("disabled")
  rows.push({ k: "focusable", v: focusable ? "yes" : "no", note: el.hasAttribute("tabindex") ? `tabindex ${el.getAttribute("tabindex")}` : undefined })
  if (el.hasAttribute("disabled")) rows.push({ k: "disabled", v: "yes" })
  return rows
}
