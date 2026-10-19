import { Marked, type Tokens } from "marked"

/**
 * Markdown for boards and docs. Spec text is the preferred way to say things
 * on a board (never rasterised, selectable, diffable), so it renders as real
 * HTML — and since the text may come from anyone with write access to the
 * repo (or an agent), the output is safe by construction:
 *  - raw HTML in the source is escaped, never passed through;
 *  - links and images only keep http(s), mailto, relative and `stavy:` URLs;
 *  - a final pass strips script-ish tags and `on*` handlers anyway.
 *
 * Embeds: `![caption](stavy:pageId/stateId)` renders as a placeholder
 * (`.ps-md-embed`) that the React side fills with a snapshot card linking to
 * the player. `[text](stavy:pageId/stateId)` is a link to the player.
 *
 * Pure (no DOM, no manifest) so it is unit-tested in Node.
 */

export interface StavyRef {
  page: string
  /** Named state id, or a value of one of the page's dimensions */
  state?: string
  /** Explicit dimension values (`stavy:page?role=manager&state=empty`) */
  dims?: Record<string, string>
}

/**
 * `stavy:expenses` · `stavy:expenses/empty` · `stavy:expenses?role=manager&state=empty`
 * (with or without the `stavy:` prefix). Null when it is not a reference.
 */
export function parseStavyRef(ref: string): StavyRef | null {
  const s = ref.trim().replace(/^stavy:(\/\/)?/, "")
  const m = s.match(/^([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_.:-]+))?(?:\?(.*))?$/)
  if (!m) return null
  const out: StavyRef = { page: m[1] }
  if (m[2]) out.state = m[2]
  if (m[3]) {
    const dims: Record<string, string> = {}
    for (const [k, v] of new URLSearchParams(m[3])) dims[k] = v
    if (Object.keys(dims).length) out.dims = dims
  }
  return out
}

/** Every `stavy:` image embed in a Markdown source, in order. */
export function findEmbeds(md: string): Array<{ ref: StavyRef; raw: string; caption: string }> {
  const out: Array<{ ref: StavyRef; raw: string; caption: string }> = []
  for (const m of md.matchAll(/!\[([^\]]*)\]\((stavy:[^)\s]+)\)/g)) {
    const ref = parseStavyRef(m[2])
    if (ref) out.push({ ref, raw: m[2], caption: m[1] })
  }
  return out
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
}

/**
 * One section of a Markdown file: from the heading whose text (or slug)
 * matches `heading` up to the next heading of the same or a higher level.
 * The whole source when the heading is not found.
 */
export function extractSection(md: string, heading: string): string {
  const want = slugify(decodeURIComponent(heading))
  const lines = md.split("\n")
  let start = -1
  let level = 0
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence
    if (fence) continue
    const h = lines[i].match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (!h) continue
    if (start === -1) {
      if (slugify(h[2]) === want) {
        start = i
        level = h[1].length
      }
    } else if (h[1].length <= level) {
      return lines.slice(start, i).join("\n").trim()
    }
  }
  return start === -1 ? md : lines.slice(start).join("\n").trim()
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")

/** A URL we are willing to put in href/src; null otherwise. */
export function safeUrl(url: string, kind: "link" | "image"): string | null {
  const u = url.trim()
  if (!u) return null
  // Strip whitespace/control chars browsers ignore inside a scheme ("java\nscript:").
  // eslint-disable-next-line no-control-regex
  const probe = u.replace(/[\u0000- ]+/g, "").toLowerCase()
  const scheme = probe.match(/^([a-z][a-z0-9+.-]*):/)?.[1]
  if (!scheme) return u // relative, #anchor, /absolute-path
  if (scheme === "http" || scheme === "https" || scheme === "stavy") return u
  if (kind === "link" && scheme === "mailto") return u
  if (kind === "image" && /^data:image\/(png|jpe?g|gif|webp);/.test(probe)) return u
  return null
}

/** Defense in depth over generated HTML: no script-ish elements, no inline handlers, no script URLs. */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(script|style|iframe|object|embed|link|meta|base|form|template|noscript)\b[^>]*>/gi, "")
    // Attributes only inside tags: text such as "onboarding = 2 steps" must survive.
    .replace(/<[a-z][a-z0-9-]*\b[^>]*>/gi, (tag) =>
      tag
        .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/\s(href|src|xlink:href|action|formaction)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (all, attr: string, _q, d, s, b) => {
          const v = (d ?? s ?? b ?? "") as string
          const decoded = v
            .replace(/&#(x?)([0-9a-f]+);?/gi, (_m, hex: string, n: string) => String.fromCharCode(parseInt(n, hex ? 16 : 10)))
            .replace(/&colon;/gi, ":")
          return safeUrl(decoded, attr.toLowerCase() === "src" ? "image" : "link") == null ? "" : all
        })
    )
}

export interface RenderOptions {
  /** Resolve a relative link or image URL (e.g. against stavy-content). */
  resolveUrl?: (url: string) => string
  /** Inline only (sticky notes, captions): no block elements. */
  inline?: boolean
}

function makeMarked(opts: RenderOptions) {
  const resolve = (u: string) => (opts.resolveUrl && !/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(u) ? opts.resolveUrl(u) : u)
  const marked = new Marked({ gfm: true, breaks: !!opts.inline })
  marked.use({
    renderer: {
      // Raw HTML in Markdown is shown as text, never rendered.
      html({ text }: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(text)
      },
      heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, { tokens, depth, text }: Tokens.Heading) {
        return `<h${depth} id="${escapeHtml(slugify(text))}">${this.parser.parseInline(tokens)}</h${depth}>\n`
      },
      link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, { href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens)
        const url = safeUrl(href, "link")
        if (url == null) return inner
        const t = title ? ` title="${escapeHtml(title)}"` : ""
        if (url.startsWith("stavy:")) return `<a href="#" data-stavy-ref="${escapeHtml(url)}"${t}>${inner}</a>`
        const ext = /^https?:/i.test(url) ? ` target="_blank" rel="noopener noreferrer"` : ""
        return `<a href="${escapeHtml(resolve(url))}"${t}${ext}>${inner}</a>`
      },
      image({ href, title, text }: Tokens.Image) {
        const url = safeUrl(href, "image")
        if (url == null) return escapeHtml(text)
        if (url.startsWith("stavy:")) {
          if (opts.inline) return `<a href="#" data-stavy-ref="${escapeHtml(url)}">${escapeHtml(text || url)}</a>`
          return `<span class="ps-md-embed" data-embed="${escapeHtml(url)}" data-caption="${escapeHtml(text)}"></span>`
        }
        const t = title ? ` title="${escapeHtml(title)}"` : ""
        return `<img src="${escapeHtml(resolve(url))}" alt="${escapeHtml(text)}"${t} loading="lazy" draggable="false">`
      },
    },
  })
  return marked
}

/** Markdown → sanitized HTML. */
export function renderMarkdown(md: string, opts: RenderOptions = {}): string {
  const marked = makeMarked(opts)
  const html = opts.inline ? (marked.parseInline(md, { async: false }) as string) : (marked.parse(md, { async: false }) as string)
  return sanitizeHtml(html)
}

/** `docs/rules.md#approval-limits` → { file, heading } */
export function splitSrc(src: string): { file: string; heading?: string } {
  const i = src.indexOf("#")
  return i === -1 ? { file: src } : { file: src.slice(0, i), heading: src.slice(i + 1) || undefined }
}
