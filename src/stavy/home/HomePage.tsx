import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { BookOpen, ChevronDown, ExternalLink, FileText, Globe, Layers, Link as LinkIcon, Map as MapIcon, Pencil, Plus, Presentation, Trash2 } from "../icons"
import { cn } from "../cn"
import { manifest, loadBoard, loadText, useManifestRev, pageUrl, contentUrl } from "../manifest"
import { StatusControl, statusLabel } from "../status"
import { fetchCommits, useContentRev, useDev, type RepoCommit } from "../dev"
import { HelpButton, ShortcutsSheet, ThemeToggle, cycleTheme, useChrome, useHotkeys } from "../chrome"
import { Markdown } from "../boards/MarkdownView"
import { PageSwitcher } from "../boards/PageSwitcher"
import { boardHref, docHref, mapHref, saveLinks, useContentIndex, useSnapshotsRev } from "../boards/store"
import { boardCover } from "../boards/resolve"
import type { BoardFile, BoardItem, ContentLink, ReadyMark } from "../types"
import { parseDecision, relativeDate, splitSections, type Section } from "./sections"

/**
 * Home: the front page of a workspace. What this is, where its work lives
 * elsewhere (links), the boards and docs, what changed lately and what was
 * decided. Everything is read from stavy-content/ — index.json, changelog.md,
 * decisions.md — so an agent keeps it current by editing files.
 */
export function HomePage() {
  const index = useContentIndex()
  const dev = useDev()
  const { hidden, theme, setTheme } = useChrome()
  useManifestRev()
  useHotkeys({ t: () => setTheme(cycleTheme(theme)) })
  const changelog = useText("changelog.md")
  const decisions = useText("decisions.md")
  const changes = useMemo(() => (changelog ? splitSections(changelog).slice(0, 3) : []), [changelog])
  const decided = useMemo(() => (decisions ? splitSections(decisions).slice(0, 4).map(parseDecision) : []), [decisions])
  const commits = useCommits()
  const boards = index.boards ?? []
  const docs = index.docs ?? []
  const product = manifest.product

  return (
    <div className="ps h-screen flex flex-col" style={{ background: "var(--ps-canvas-bg)" }} data-testid="home">
      {!hidden && (
        <div className="flex items-center justify-between gap-3 p-4 pb-0">
          <div className="ps-glass rounded-2xl pl-3.5 pr-1.5 py-1.5 flex items-center gap-2.5" data-ps-ui>
            <Layers className="size-4" style={{ color: "var(--ps-muted)" }} />
            <span className="font-semibold text-[13px]">Stavy</span>
            <span style={{ color: "var(--ps-faint)" }}>/</span>
            <span className="font-medium text-[13px]">{product.name}</span>
            <span style={{ color: "var(--ps-faint)" }}>/</span>
            <PageSwitcher current={{ kind: "home" }} />
          </div>
          <div className="ps-glass rounded-2xl px-1.5 py-1 flex items-center gap-0.5" data-ps-ui>
            <ThemeToggle tipBelow />
            <HelpButton tipBelow />
          </div>
        </div>
      )}
      <ShortcutsSheet items={[["Theme", "T"], ["Hide / show UI", "⌘ \\ ⇧ H"], ["This sheet", "?"]]} />

      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="ps-home">
          <header className="ps-home-head">
            <h1>{product.name}</h1>
            {product.description && <p>{product.description}</p>}
            <nav className="ps-home-nav" aria-label="Open">
              <Link className="ps-btn" to={mapHref()}>
                <MapIcon /> Open the map
              </Link>
              {docs[0] && (
                <Link className="ps-btn" to={docHref(docs[0].id)}>
                  <FileText /> Docs
                </Link>
              )}
            </nav>
          </header>

          <LinksSection links={index.links ?? []} writable={!!dev?.writable} />

          <ReadySection boardIds={boards.map((b) => b.id)} />

          {boards.length > 0 && (
            <section className="ps-home-sec">
              <h2>Boards</h2>
              <div className="ps-home-cards">
                {boards.map((b) => (
                  <BoardCardLink key={b.id} id={b.id} title={b.title} description={b.description} />
                ))}
              </div>
            </section>
          )}

          {docs.length > 0 && (
            <section className="ps-home-sec">
              <h2>Docs</h2>
              <div className="ps-home-cards ps-home-cards-docs">
                {docs.map((d) => (
                  <Link key={d.id} to={docHref(d.id)} className="ps-home-card ps-home-doc">
                    <FileText className="ps-home-doc-icon" />
                    <div>
                      <div className="ps-home-card-title">{d.title}</div>
                      {d.description && <div className="ps-sub">{d.description}</div>}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {changes.length > 0 && (
            <section className="ps-home-sec" data-testid="home-changes">
              <h2>
                What changed <Link to={docHref("changelog")} className="ps-home-more">All changes</Link>
              </h2>
              <div className="ps-home-changes">
                {changes.map((c) => (
                  <ChangeEntry key={c.title} section={c} />
                ))}
              </div>
            </section>
          )}

          {decided.length > 0 && (
            <section className="ps-home-sec" data-testid="home-decisions">
              <h2>
                Decisions <Link to={docHref("decisions")} className="ps-home-more">Decision log</Link>
              </h2>
              <div className="ps-home-decisions">
                {decided.map((d, i) => (
                  <article key={i} className="ps-home-decision">
                    <div className="ps-home-decision-h">
                      <span className="ps-home-decision-t">{d.title}</span>
                      {d.status && <span className={cn("ps-chip ps-chip-sm", `ps-status-${d.status.toLowerCase().split(/\W/)[0]}`)}>{d.status}</span>}
                    </div>
                    {d.date && <div className="ps-sub">{d.date}</div>}
                    {d.why && <p>{d.why}</p>}
                    {d.alternatives && (
                      <p className="ps-sub">
                        <span className="ps-home-k">Instead of</span> {d.alternatives}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {commits && commits.length > 0 && (
            <section className="ps-home-sec" data-testid="home-commits">
              <h2>Recent commits</h2>
              <ul className="ps-home-commits">
                {commits.slice(0, 10).map((c) => (
                  <li key={c.hash}>
                    <code className="ps-mono">{c.hash.slice(0, 7)}</code>
                    <span className="ps-home-commit-s">{c.subject}</span>
                    <span className="ps-sub">
                      {c.author} · {relativeDate(c.date)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

/** A Markdown file in stavy-content, live-reloaded in dev; null until loaded or when absent. */
function useText(file: string): string | null {
  const rev = useContentRev()
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let off = false
    loadText(file).then(
      (t) => !off && setText(t),
      () => !off && setText(null)
    )
    return () => {
      off = true
    }
  }, [file, rev])
  return text
}

function useCommits(): RepoCommit[] | null {
  const rev = useContentRev()
  const [rows, setRows] = useState<RepoCommit[] | null>(null)
  useEffect(() => {
    let off = false
    void fetchCommits(10).then((r) => !off && setRows(r))
    return () => {
      off = true
    }
  }, [rev])
  return rows
}

function ChangeEntry({ section }: { section: Section }) {
  return (
    <article className="ps-home-change">
      <h3>{section.title}</h3>
      <Markdown md={section.body} className="ps-home-md" embedWidth={240} />
    </article>
  )
}

/* ---------------- boards ---------------- */

function BoardCardLink({ id, title, description }: { id: string; title: string; description?: string }) {
  const rev = useContentRev()
  useSnapshotsRev()
  const [board, setBoard] = useState<BoardFile | null>(null)
  useEffect(() => {
    let off = false
    loadBoard(id).then(
      (b) => !off && setBoard(b),
      () => {}
    )
    return () => {
      off = true
    }
  }, [id, rev])
  const cover = board ? boardCover(board, contentUrl) : null
  const [broken, setBroken] = useState(false)
  const status = board?.status
  return (
    <Link to={boardHref(id)} className="ps-home-card ps-home-board">
      <div className="ps-home-thumb">
        {cover && !broken ? (
          <img src={cover.url} alt="" loading="lazy" draggable={false} className={cover.fit === "contain" ? "is-contain" : undefined} onError={() => setBroken(true)} />
        ) : (
          <Presentation />
        )}
      </div>
      <div className="ps-home-card-body">
        <div className="ps-home-card-h">
          <span className="ps-home-card-title">{board?.title ?? title}</span>
          {status && <StatusControl status={status} ready={board?.ready} />}
        </div>
        {(board?.description ?? description) && <div className="ps-sub">{board?.description ?? description}</div>}
      </div>
    </Link>
  )
}

/* ---------------- ready for dev ---------------- */

type ReadyRow = { key: string; title: string; context?: string; href: string; ready?: ReadyMark }

function useBoardFiles(ids: string[]): Record<string, BoardFile> {
  const rev = useContentRev()
  const [files, setFiles] = useState<Record<string, BoardFile>>({})
  const key = ids.join(",")
  useEffect(() => {
    let off = false
    Promise.all(ids.map((id) => loadBoard(id).then((b) => [id, b] as const, () => null))).then((rows) => {
      if (!off) setFiles(Object.fromEntries(rows.filter((r): r is readonly [string, BoardFile] => !!r)))
    })
    return () => {
      off = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rev])
  return files
}

/**
 * What engineers can pick up: every screen, state and board marked "ready",
 * newest first, with who marked it and whether it changed since.
 */
function ReadySection({ boardIds }: { boardIds: string[] }) {
  const files = useBoardFiles(boardIds)
  const rows: ReadyRow[] = []
  const counts: Record<string, number> = {}
  const count = (s?: string) => s && s !== "ready" && (counts[s] = (counts[s] ?? 0) + 1)
  for (const p of manifest.pages) {
    count(p.status)
    if (p.status === "ready") rows.push({ key: `page:${p.id}`, title: p.label, context: "Screen", href: pageUrl(p.id, {}), ready: p.ready })
    for (const st of p.states ?? []) {
      count(st.status)
      if (st.status === "ready")
        rows.push({ key: `state:${p.id}/${st.id}`, title: st.label ?? st.id, context: p.label, href: pageUrl(p.id, { _state: st.id }), ready: st.ready })
    }
  }
  for (const id of boardIds) {
    const b = files[id]
    count(b?.status)
    if (b?.status === "ready") rows.push({ key: `board:${id}`, title: b.title, context: "Board", href: boardHref(id), ready: b.ready })
  }
  if (!rows.length && !Object.keys(counts).length) return null
  rows.sort((a, b) => (b.ready?.at ?? "").localeCompare(a.ready?.at ?? ""))
  const others = Object.entries(counts).map(([s, n]) => `${n} ${statusLabel(s).toLowerCase()}`)
  return (
    <section className="ps-home-sec" data-testid="home-ready">
      <h2>
        Ready for dev {others.length > 0 && <span className="ps-home-more">{others.join(", ")}</span>}
      </h2>
      {rows.length === 0 ? (
        <p className="ps-sub">Nothing is marked ready yet. Set a screen, state or board to Ready for dev in the editor.</p>
      ) : (
        <ul className="ps-home-ready">
          {rows.map((r) => (
            <li key={r.key}>
              <Link to={r.href} className="ps-home-ready-t">
                {r.title}
              </Link>
              {r.context && <span className="ps-sub">{r.context}</span>}
              <span className="ps-home-ready-meta">
                <StatusControl status="ready" ready={r.ready} />
                {r.ready?.at && (
                  <span className="ps-sub">
                    {r.ready.at}
                    {r.ready.by ? `, ${r.ready.by}` : ""}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ---------------- links ---------------- */

const KIND_ICON: Record<string, typeof Globe> = { prd: FileText, doc: BookOpen, repo: LinkIcon, figma: Layers, ticket: ExternalLink }

function host(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}

function LinksSection({ links, writable }: { links: ContentLink[]; writable: boolean }) {
  const [editing, setEditing] = useState(false)
  if (!links.length && !writable) return null
  return (
    <section className="ps-home-sec" data-testid="home-links">
      <h2>
        Links
        {writable && !editing && (
          <button type="button" className="ps-home-more" onClick={() => setEditing(true)}>
            <Pencil className="size-3" /> Edit
          </button>
        )}
      </h2>
      {editing ? (
        <LinksEditor links={links} onDone={() => setEditing(false)} />
      ) : links.length ? (
        <div className="ps-home-links">
          {links.map((l, i) => {
            const Icon = KIND_ICON[(l.kind ?? "").toLowerCase()] ?? Globe
            return (
              <a key={i} className="ps-home-link" href={l.url} target="_blank" rel="noreferrer noopener">
                <Icon className="ps-home-link-icon" />
                <span className="ps-home-link-t">{l.title}</span>
                <span className="ps-sub">{l.kind ? `${l.kind} · ` : ""}{host(l.url)}</span>
              </a>
            )
          })}
        </div>
      ) : (
        <p className="ps-sub">Add the PRD, tickets, Figma file or repo this work belongs to.</p>
      )}
    </section>
  )
}

function LinksEditor({ links, onDone }: { links: ContentLink[]; onDone: () => void }) {
  const [rows, setRows] = useState<ContentLink[]>(links.map((l) => ({ ...l })))
  const [busy, setBusy] = useState(false)
  const set = (i: number, patch: Partial<ContentLink>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i: number, d: number) =>
    setRows((r) => {
      const j = i + d
      if (j < 0 || j >= r.length) return r
      const n = [...r]
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })
  const save = async () => {
    setBusy(true)
    try {
      const clean = rows
        .map((r) => ({ title: r.title.trim(), url: r.url.trim(), ...(r.kind?.trim() ? { kind: r.kind.trim() } : {}) }))
        .filter((r) => r.url)
        .map((r) => ({ ...r, title: r.title || host(r.url) }))
      await saveLinks(clean)
      onDone()
    } catch (e) {
      alert(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ps-home-editor">
      {rows.map((r, i) => (
        <div key={i} className="ps-home-edit-row" data-testid="link-row">
          <input className="ps-input" placeholder="Title" aria-label="Link title" value={r.title} onChange={(e) => set(i, { title: e.target.value })} />
          <input className="ps-input ps-home-edit-url" placeholder="https://…" aria-label="Link URL" value={r.url} onChange={(e) => set(i, { url: e.target.value })} />
          <input className="ps-input ps-home-edit-kind" placeholder="kind" aria-label="Link kind" list="ps-link-kinds" value={r.kind ?? ""} onChange={(e) => set(i, { kind: e.target.value })} />
          <button type="button" className="ps-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
            <ChevronDown style={{ transform: "rotate(180deg)" }} />
          </button>
          <button type="button" className="ps-btn" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
            <ChevronDown />
          </button>
          <button type="button" className="ps-btn" aria-label="Remove link" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
            <Trash2 />
          </button>
        </div>
      ))}
      <datalist id="ps-link-kinds">
        {["prd", "ticket", "figma", "repo", "doc"].map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      <div className="flex items-center gap-2 mt-2">
        <button type="button" className="ps-btn" onClick={() => setRows((r) => [...r, { title: "", url: "" }])}>
          <Plus /> Add link
        </button>
        <span className="flex-1" />
        <button type="button" className="ps-btn" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="ps-btn ps-btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  )
}
