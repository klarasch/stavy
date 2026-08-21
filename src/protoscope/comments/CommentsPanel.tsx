import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { X, MessageCircle, Link as LinkIcon, FileText, Upload, Trash2, Check } from "lucide-react"
import { PsButton, Kbd } from "../chrome"
import { getPage, pageUrl } from "../manifest"
import { useComments, shareUrl, toMarkdown, decodePayload, describeAnchor, timeAgo } from "./store"

/** The list of all comments in the workspace, with share / import actions. */
export function CommentsPanel({ onClose, onAdd }: { onClose: () => void; onAdd?: () => void }) {
  const { comments, importMany, clearAll, author, setAuthor } = useComments()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open")
  const [flash, setFlash] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState("")

  const list = useMemo(
    () => comments.filter((c) => (filter === "all" ? true : filter === "open" ? !c.resolved : c.resolved)).sort((a, b) => b.createdAt - a.createdAt),
    [comments, filter]
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
    <div className="ps ps-glass-strong fixed right-4 top-4 w-[360px] rounded-2xl z-50 overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 32px)" }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--ps-border)" }}>
        <MessageCircle className="size-4" style={{ color: "var(--ps-comment)" }} />
        <span className="text-[13px] font-semibold">Comments</span>
        <span className="ps-sub">{comments.filter((c) => !c.resolved).length} open</span>
        <button className="ml-auto cursor-pointer" style={{ color: "var(--ps-faint)" }} onClick={onClose} title="Close">
          <X className="size-4" />
        </button>
      </div>

      <div className="px-4 py-2.5 flex items-center gap-1.5 flex-wrap" style={{ borderBottom: "1px solid var(--ps-border)" }}>
        <div className="ps-seg">
          {(["open", "resolved", "all"] as const).map((f) => (
            <button key={f} data-on={filter === f ? "true" : undefined} onClick={() => setFilter(f)} className="capitalize">
              {f}
            </button>
          ))}
        </div>
        {onAdd && (
          <PsButton primary className="ml-auto h-7" onClick={onAdd} tip="Place a comment on this page" keys={["M"]}>
            New comment
          </PsButton>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <div className="px-4 py-8 text-center ps-sub">
            {comments.length === 0 ? (
              <>
                No comments yet. On a page, press <Kbd>M</Kbd> and click anywhere to leave one.
              </>
            ) : (
              "Nothing here."
            )}
          </div>
        ) : (
          list.map((c) => {
            const page = getPage(c.page)
            return (
              <button
                key={c.id}
                className="w-full text-left px-4 py-2.5 flex gap-2.5 cursor-pointer ps-crow"
                onClick={() => navigate(pageUrl(c.page, c.dims, { c: c.id }))}
                title="Open on the page"
              >
                <span className="ps-cbubble" style={{ position: "static", transform: "none", flexShrink: 0 }} data-resolved={c.resolved ? "true" : undefined}>
                  {(c.author || "?").slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--ps-muted)" }}>
                    <span className="font-semibold" style={{ color: "var(--ps-fg)" }}>{c.author || "anonymous"}</span>
                    {timeAgo(c.createdAt)}
                    {c.resolved && <Check className="size-3" style={{ color: "var(--ps-comment)" }} />}
                  </span>
                  <span className="block text-[12.5px] leading-snug mt-0.5 line-clamp-2">{c.body}</span>
                  <span className="block text-[10.5px] mt-1 truncate" style={{ color: "var(--ps-faint)" }}>
                    {page ? describeAnchor(c) : c.page}
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
            className="h-7"
            onClick={async () => {
              const url = await shareUrl(comments)
              // ~60 chars per comment compressed; Safari/Slack are comfortable below ~60k.
              if (url.length > 60000) copy(await toMarkdown(comments), "Too many comments for one link — copied the Markdown digest instead")
              else copy(url, "Link copied — paste it in Slack")
            }}
            disabled={comments.length === 0}
          >
            <LinkIcon /> Link
          </PsButton>
          <PsButton className="h-7" tip="Copy a Slack-ready Markdown digest" onClick={async () => copy(await toMarkdown(comments), "Markdown copied")} disabled={comments.length === 0}>
            <FileText /> Markdown
          </PsButton>
          <PsButton className="h-7" active={importing} tip="Unpack a link or payload from a colleague" onClick={() => setImporting((v) => !v)}>
            <Upload /> Import
          </PsButton>
          <PsButton
            icon
            className="h-7 ml-auto"
            tip="Delete all comments in this browser"
            onClick={() => {
              if (confirm("Delete all comments stored in this browser?")) clearAll()
            }}
            disabled={comments.length === 0}
          >
            <Trash2 />
          </PsButton>
        </div>
        {importing && (
          <div className="flex flex-col gap-1.5">
            <textarea
              className="ps-cinput"
              rows={2}
              placeholder="Paste a share link or payload from Slack…"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div className="flex gap-1">
              <PsButton
                primary
                className="h-7"
                onClick={async () => {
                  try {
                    const n = importMany(await decodePayload(importText))
                    say(`Imported ${n} new comment(s)`)
                    setImportText("")
                    setImporting(false)
                  } catch {
                    say("That doesn't look like a comments payload")
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
        {flash && (
          <div className="text-[11px]" style={{ color: "var(--ps-comment)" }}>
            {flash}
          </div>
        )}
      </div>
    </div>
  )
}
