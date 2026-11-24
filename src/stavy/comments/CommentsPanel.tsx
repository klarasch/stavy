import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { X, MessageCircle, Link as LinkIcon, FileText, Upload, Check } from "../icons"
import { PsButton, Kbd } from "../chrome"
import { useComments, shareUrl, toMarkdown, decodeRounds, describeAnchor, timeAgo, downloadText, commentHref, initials, type Comment } from "./store"
import { manifest } from "../manifest"

export interface CommentsHere {
  /** What "here" is, e.g. the page's or board's name */
  label: string
  test: (c: Comment) => boolean
  /** Open a comment that is here without navigating (select it in place) */
  open?: (c: Comment) => void
}

const STORAGE_NOTE = {
  file: "Saved as review rounds in stavy-content/rounds/",
  local: "Kept in this browser until you send them: Send feedback",
  module: "Saved through the workspace's comments adapter",
} as const

/**
 * Every comment in the workspace — player, map, boards, docs — with "here"
 * (this page, board or doc) vs "everywhere", open/resolved, and share /
 * import actions. Clicking a comment takes you to its place and opens it.
 */
export function CommentsPanel({ onClose, onAdd, wireframe, here }: { onClose: () => void; onAdd?: () => void; wireframe?: boolean; here?: CommentsHere }) {
  const { comments, importRounds, outgoing, author, setAuthor, mode } = useComments()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<"open" | "addressed" | "resolved" | "all">("open")
  const [scope, setScope] = useState<"here" | "everywhere">(() => (here && comments.some((c) => here.test(c)) ? "here" : "everywhere"))
  const [flash, setFlash] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState("")
  const [sent, setSent] = useState(false)

  const list = useMemo(
    () =>
      comments
        .filter((c) => (filter === "all" ? true : filter === "resolved" ? c.resolved : c.status === filter))
        .filter((c) => !here || scope === "everywhere" || here.test(c))
        .sort((a, b) => b.createdAt - a.createdAt),
    [comments, filter, scope, here]
  )
  const say = (msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash(null), 1600)
  }
  const copy = async (text: string, msg: string) => {
    await navigator.clipboard?.writeText(text)
    say(msg)
  }

  return (
    <div className="ps ps-glass-strong fixed right-4 top-4 w-[360px] rounded-2xl overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 32px)", zIndex: "var(--ps-z-chrome)" }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--ps-border)" }}>
        <MessageCircle className="size-4" style={{ color: "var(--ps-comment)" }} />
        <span className="text-[13px] font-semibold">Comments</span>
        <span className="ps-sub">
          {comments.filter((c) => c.status === "open").length} open
          {comments.some((c) => c.status === "addressed") && ` · ${comments.filter((c) => c.status === "addressed").length} addressed`}
        </span>
        <button className="ml-auto cursor-pointer" style={{ color: "var(--ps-faint)" }} onClick={onClose} title="Close">
          <X className="size-4" />
        </button>
      </div>

      <div className="px-4 py-2.5 flex items-center gap-1.5 flex-wrap" style={{ borderBottom: "1px solid var(--ps-border)" }}>
        <div className="ps-seg">
          {(["open", "addressed", "resolved", "all"] as const).map((f) => (
            <button key={f} data-on={filter === f ? "true" : undefined} onClick={() => setFilter(f)} className="capitalize">
              {f}
            </button>
          ))}
        </div>
        {here && (
          <div className="ps-seg" data-ps-scope>
            <button data-on={scope === "here" ? "true" : undefined} onClick={() => setScope("here")} title={`Only ${here.label}`}>
              Here
            </button>
            <button data-on={scope === "everywhere" ? "true" : undefined} onClick={() => setScope("everywhere")} title="Player, map, boards and docs">
              Everywhere
            </button>
          </div>
        )}
        {onAdd && (
          <PsButton primary className="ml-auto h-7" onClick={onAdd} tip="Place a comment here" keys={["M"]}>
            New comment
          </PsButton>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <div className="px-4 py-8 text-center ps-sub">
            {comments.length === 0 ? (
              <>
                No comments yet. Press <Kbd>M</Kbd> and click anything (a page, a board, a doc) to leave one.
              </>
            ) : (
              "Nothing here."
            )}
          </div>
        ) : (
          list.map((c) => {
            const isHere = !!here?.test(c)
            return (
              <button
                key={c.id}
                className="w-full text-left px-4 py-2.5 flex gap-2.5 cursor-pointer ps-crow"
                data-here={isHere && scope === "everywhere" ? "true" : undefined}
                data-comment-row={c.id}
                onClick={() => {
                  if (isHere && here?.open) here.open(c)
                  else navigate(commentHref(c, wireframe ? { w: "1" } : {}))
                }}
                title="Open it where it is"
              >
                <span className="ps-cbubble" style={{ position: "static", transform: "none", flexShrink: 0 }} data-resolved={c.resolved ? "true" : undefined}>
                  {initials(c.author || "?")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--ps-muted)" }}>
                    <span className="font-semibold" style={{ color: "var(--ps-fg)" }}>{c.author || "anonymous"}</span>
                    {timeAgo(c.createdAt)}
                    {c.resolved && <Check className="size-3" style={{ color: "var(--ps-comment)" }} />}
                    {c.status === "addressed" && <span data-ps-status="addressed">addressed{c.addressedIn ? ` in ${c.addressedIn}` : ""}</span>}
                  </span>
                  <span className="block text-[12.5px] leading-snug mt-0.5 line-clamp-2">{c.body}</span>
                  <span className="block text-[10.5px] mt-1 truncate" style={{ color: "var(--ps-faint)" }}>
                    {describeAnchor(c)}
                    {c.replies.length > 0 && ` · ${c.replies.length} repl${c.replies.length === 1 ? "y" : "ies"}`}
                  </span>
                </span>
              </button>
            )
          })
        )}
      </div>

      <div className="px-3 py-2.5 flex flex-col gap-2" style={{ borderTop: "1px solid var(--ps-border)" }}>
        <div className="flex items-center gap-1">
          <PsButton
            primary={mode === "local"}
            className="h-7"
            tip="Copy one link with these comments to send back to whoever shared this prototype; opening it offers to import them as a round"
            onClick={async () => {
              const url = await shareUrl(outgoing)
              // Chat apps and Safari are comfortable below ~60k characters.
              if (url.length > 60000) {
                downloadText(`${manifest.product.name.toLowerCase()}-feedback-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ v: 1, rounds: outgoing }, null, 2), "application/json")
                say("Too much for one link: downloaded a file to send instead (paste it into Import)")
              } else {
                await copy(url, "Link copied: send it to whoever shared this prototype")
              }
              setSent(true)
            }}
            disabled={outgoing.length === 0}
          >
            <LinkIcon /> Send feedback
          </PsButton>
          <PsButton
            className="h-7"
            tip="Download the same feedback as a Markdown digest, for reading in chat or a ticket"
            onClick={async () => {
              downloadText(`${manifest.product.name.toLowerCase()}-feedback-${new Date().toISOString().slice(0, 10)}.md`, await toMarkdown(outgoing, comments), "text/markdown")
              say("Digest downloaded")
            }}
            disabled={outgoing.length === 0}
          >
            <FileText /> Digest .md
          </PsButton>
          <PsButton className="h-7 ml-auto" active={importing} tip="Take in a feedback link or file from a reviewer" onClick={() => setImporting((v) => !v)}>
            <Upload /> Import
          </PsButton>
        </div>
        {sent && mode === "local" && (
          <div className="text-[11px]" style={{ color: "var(--ps-muted)" }} data-ps-sent>
            Whoever maintains this prototype opens the link in their dev viewer and imports your round. The digest is the same feedback to read.
          </div>
        )}
        {importing && (
          <div className="flex flex-col gap-1.5">
            <textarea
              className="ps-cinput"
              rows={2}
              placeholder="Paste a feedback link, or the contents of a feedback file…"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div className="flex gap-1">
              <PsButton
                primary
                className="h-7"
                onClick={async () => {
                  try {
                    const n = importRounds(await decodeRounds(importText))
                    say(n ? `Imported ${n} new comment(s)` : "Nothing new in that round")
                    setImportText("")
                    setImporting(false)
                  } catch {
                    say("That doesn't look like Stavy feedback")
                  }
                }}
              >
                Unpack
              </PsButton>
              <PsButton className="h-7" onClick={() => setImporting(false)}>Cancel</PsButton>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 text-[11px] whitespace-nowrap" style={{ color: "var(--ps-muted)" }}>
          <span>Commenting as</span>
          <input
            className="ps-cinput h-6 py-0 px-2 flex-1 min-w-0"
            placeholder="your name"
            defaultValue={author}
            onBlur={(e) => setAuthor(e.target.value.trim())}
          />
        </div>
        <div className="text-[10.5px]" style={{ color: "var(--ps-faint)" }} data-ps-storage={mode}>
          {STORAGE_NOTE[mode]}
        </div>
        {flash && (
          <div className="text-[11px]" style={{ color: "var(--ps-comment)" }}>
            {flash}
          </div>
        )}
      </div>
    </div>
  )
}
