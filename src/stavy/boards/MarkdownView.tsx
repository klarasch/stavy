import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import { contentUrl, loadText, pageUrl } from "../manifest"
import { useContentRev } from "../dev"
import { cn } from "../cn"
import { extractSection, parseStavyRef, renderMarkdown, splitSrc } from "./markdown"
import { resolveRef } from "./resolve"
import { ShotCard } from "./ShotCard"

/** Load a Markdown file from stavy-content (`docs/x.md`, `docs/x.md#heading`), live-reloaded in dev. */
export function useMarkdownSource(src: string | undefined): { text: string | null; error: string | null } {
  const rev = useContentRev()
  const [state, setState] = useState<{ text: string | null; error: string | null }>({ text: null, error: null })
  useEffect(() => {
    if (!src) return
    let cancelled = false
    const { file, heading } = splitSrc(src)
    loadText(file).then(
      (t) => !cancelled && setState({ text: heading ? extractSection(t, heading) : t, error: null }),
      (e: unknown) => !cancelled && setState({ text: null, error: String((e as Error)?.message ?? e) })
    )
    return () => {
      cancelled = true
    }
  }, [src, rev])
  return state
}

/**
 * Rendered Markdown: real, selectable HTML (sanitized — see markdown.ts), with
 * `![caption](stavy:page/state)` embeds filled in by snapshot cards that open
 * the player, and `[text](stavy:page/state)` links into it.
 */
export const Markdown = memo(function Markdown({
  md,
  inline = false,
  className,
  embedWidth = 420,
}: {
  md: string
  inline?: boolean
  className?: string
  /** Width of embedded snapshot cards (px) */
  embedWidth?: number
}) {
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderMarkdown(md, { inline, resolveUrl: (u) => contentUrl(u) }), [md, inline])
  const [embeds, setEmbeds] = useState<Array<{ el: HTMLElement; ref: string; caption: string }>>([])

  // The HTML is written here, not through dangerouslySetInnerHTML: the embed
  // placeholders are portal targets, and React must never swap them out from
  // under the cards it renders into them.
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    root.innerHTML = html
    setEmbeds(
      [...root.querySelectorAll<HTMLElement>(".ps-md-embed")].map((el) => ({
        el,
        ref: el.dataset.embed ?? "",
        caption: el.dataset.caption ?? "",
      }))
    )
  }, [html])

  const onClick = (e: React.MouseEvent) => {
    // Viewer links (`?b=board`, `?doc=id`) stay inside the app, no page load.
    const local = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="?"]')
    if (local && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      navigate(local.getAttribute("href")!)
      return
    }
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-stavy-ref]")
    if (!a) return
    e.preventDefault()
    const r = parseStavyRef(a.dataset.stavyRef ?? "")
    const shot = r && resolveRef(r)
    if (shot) navigate(pageUrl(shot.page.id, shot.dims))
  }

  const Tag = inline ? "span" : "div"
  return (
    <>
      <Tag ref={ref} className={cn("ps-md", inline && "ps-md-inline", className)} onClick={onClick} />
      {embeds.map((e, i) => createPortal(<Embed refText={e.ref} caption={e.caption} width={embedWidth} />, e.el, `${i}:${e.ref}`))}
    </>
  )
})

function Embed({ refText, caption, width }: { refText: string; caption: string; width: number }) {
  const r = parseStavyRef(refText)
  const shot = r ? resolveRef(r) : null
  if (!shot) return <span className="ps-md-embed-missing">Unknown screen: {refText.replace(/^stavy:/, "")}</span>
  return (
    <span className="ps-md-embed-card" style={{ width }}>
      <ShotCard shot={shot} width={width} />
      {caption && <span className="ps-md-caption">{caption}</span>}
    </span>
  )
}
