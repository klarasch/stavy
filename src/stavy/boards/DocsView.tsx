import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { FileText, Layers, Pencil, Plus } from "../icons"
import { cn } from "../cn"
import { manifest } from "../manifest"
import { useDev, writeContent } from "../dev"
import { HelpButton, PsButton, PsDivider, ShortcutsSheet, ThemeToggle, cycleTheme, useChrome, useHotkeys } from "../chrome"
import { Markdown, useMarkdownSource } from "./MarkdownView"
import { PageSwitcher } from "./PageSwitcher"
import { createDoc, docHref, useContentIndex } from "./store"

/**
 * Docs: the written half of a handover — specs, rules, decisions — as
 * Markdown files in stavy-content/docs/, listed in index.json. Rendered with
 * the same embeds as boards (`![caption](stavy:page/state)` shows the real
 * state and opens it). With the dev endpoint a doc can be edited as plain
 * Markdown and saved back.
 */
const docPath = (d: { src?: string } | undefined, id: string) => d?.src ?? `docs/${id}.md`

export function DocsView() {
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const index = useContentIndex()
  const dev = useDev()
  const { hidden, theme, setTheme } = useChrome()
  useHotkeys({ t: () => setTheme(cycleTheme(theme)) })
  const docs = index.docs ?? []
  const id = sp.get("doc") || docs[0]?.id || ""
  const current = docs.find((d) => d.id === id)
  const { text, error } = useMarkdownSource(id ? docPath(current, id) : undefined)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [newTitle, setNewTitle] = useState<string | null>(null)
  useEffect(() => setEditing(null), [id])

  const save = async () => {
    if (editing == null) return
    setSaving(true)
    try {
      await writeContent(docPath(current, id), editing)
      setEditing(null)
    } catch (e) {
      alert(String((e as Error).message ?? e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ps h-screen flex flex-col" style={{ background: "var(--ps-canvas-bg)" }}>
      {!hidden && (
        <div className="flex items-center justify-between gap-3 p-4 pb-0">
          <div className="ps-glass rounded-2xl pl-3.5 pr-1.5 py-1.5 flex items-center gap-2.5" data-ps-ui>
            <Layers className="size-4" style={{ color: "var(--ps-muted)" }} />
            <span className="font-semibold text-[13px]">Stavy</span>
            <span style={{ color: "var(--ps-faint)" }}>/</span>
            <span className="font-medium text-[13px]">{manifest.product.name}</span>
            <span style={{ color: "var(--ps-faint)" }}>/</span>
            <PageSwitcher current={{ kind: "docs" }} />
          </div>
          <div className="ps-glass rounded-2xl px-1.5 py-1 flex items-center gap-0.5" data-ps-ui>
            {dev?.writable && current && (
              <>
                {editing == null ? (
                  <PsButton tip="Edit this doc as Markdown" tipBelow onClick={() => setEditing(text ?? "")} disabled={text == null}>
                    <Pencil /> Edit
                  </PsButton>
                ) : (
                  <>
                    <PsButton tip="Discard changes" tipBelow onClick={() => setEditing(null)}>
                      Cancel
                    </PsButton>
                    <button type="button" className="ps-btn ps-btn-primary" disabled={saving} onClick={() => void save()}>
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </>
                )}
                <PsDivider />
              </>
            )}
            <ThemeToggle tipBelow />
            <HelpButton tipBelow />
          </div>
        </div>
      )}
      <ShortcutsSheet items={[["Theme", "T"], ["Hide / show UI", "⌘ \\ ⇧ H"], ["This sheet", "?"]]} />

      <div className="flex-1 min-h-0 flex gap-4 p-4">
        <nav className="ps-docs-nav ps-glass rounded-2xl p-1.5 shrink-0" aria-label="Docs">
          <div className="ps-toc-h">Docs</div>
          {docs.map((d) => (
            <button key={d.id} type="button" className={cn("ps-toc-item", d.id === id && "is-on")} onClick={() => navigate(docHref(d.id))}>
              <FileText className="size-3.5 shrink-0" /> <span className="truncate">{d.title}</span>
            </button>
          ))}
          {!docs.length && <div className="ps-sub px-2.5 py-2">No docs yet. Agents add them to stavy-content/docs/ and list them in index.json.</div>}
          {dev?.writable &&
            (newTitle == null ? (
              <button type="button" className="ps-toc-item" onClick={() => setNewTitle("")}>
                <Plus className="size-3.5 shrink-0" /> New doc
              </button>
            ) : (
              <form
                className="flex flex-col gap-1.5 p-1.5"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!newTitle.trim()) return
                  const nid = await createDoc(newTitle.trim())
                  setNewTitle(null)
                  navigate(docHref(nid))
                }}
              >
                <input autoFocus className="ps-input" placeholder="Doc title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNewTitle(null)} />
              </form>
            ))}
        </nav>

        <main className="ps-docs-main flex-1 min-w-0 overflow-y-auto rounded-2xl">
          {editing != null ? (
            <textarea className="ps-docs-editor ps-mono" value={editing} onChange={(e) => setEditing(e.target.value)} autoFocus spellCheck />
          ) : error ? (
            <div className="ps-docs-page ps-sub">{current ? `Could not load ${docPath(current, id)} (${error})` : `No doc “${id}”.`}</div>
          ) : text == null ? (
            id ? <div className="ps-docs-page"><div className="ps-skeleton" style={{ height: 240 }} /></div> : null
          ) : (
            <article className="ps-docs-page">
              <Markdown md={text} className="ps-docs-md" embedWidth={560} />
            </article>
          )}
        </main>
      </div>
    </div>
  )
}
