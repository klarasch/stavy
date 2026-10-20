/** Home reads changelog.md and decisions.md as `## heading` sections. Pure, so it can be tested. */

export interface Section {
  title: string
  body: string
}

/** The `## ` sections of a Markdown file, in file order (text before the first one is dropped; fenced code is respected). */
export function splitSections(md: string): Section[] {
  const out: Section[] = []
  let cur: { title: string; lines: string[] } | null = null
  let fence = false
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const h = !fence && /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (h) {
      if (cur) out.push({ title: cur.title, body: cur.lines.join("\n").trim() })
      cur = { title: h[1], lines: [] }
    } else cur?.lines.push(line)
  }
  if (cur) out.push({ title: cur.title, body: cur.lines.join("\n").trim() })
  return out
}

export interface Decision {
  date?: string
  title: string
  why?: string
  alternatives?: string
  status?: string
}

/** `## 2026-10-12 — Decision` with `**Why:**`, `**Alternatives:**`, `**Status:**` lines. */
export function parseDecision(s: Section): Decision {
  const m = /^(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+)$/.exec(s.title)
  const d: Decision = m ? { date: m[1], title: m[2] } : { title: s.title }
  for (const line of s.body.split("\n")) {
    const f = /^(why|alternatives|status)\s*:\s*(.*)$/i.exec(line.replace(/[*_]/g, "").replace(/^[\s>-]+/, ""))
    if (f) d[f[1].toLowerCase() as "why" | "alternatives" | "status"] = f[2].trim()
  }
  return d
}

/** "3 days ago", "yesterday" … for an ISO date; the date itself beyond a year. */
export function relativeDate(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const secs = Math.round((t - now) / 1000)
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]]
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
  for (const [u, n] of units) if (Math.abs(secs) >= n) return rtf.format(Math.round(secs / n), u)
  return "just now"
}
