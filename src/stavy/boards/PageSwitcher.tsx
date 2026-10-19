import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { StavyLayer } from "../toplayer"
import { Check, ChevronDown, FileText, Map as MapIcon, Pencil, Plus, Presentation, Trash2 } from "../icons"
import { useDev } from "../dev"
import { boardHref, createBoard, docHref, mapHref, rememberView, removeBoard, renameBoard, useContentIndex } from "./store"
import type { BoardFile } from "../types"

export type PageRef = { kind: "map" } | { kind: "board"; id: string } | { kind: "docs" }

/**
 * The page switcher in the canvas chrome, next to the product name:
 * Map (the generated canvas) · each authored board · Docs. Quiet by design —
 * one pill that reads as the current page's name. With the dev endpoint it
 * also creates, renames and deletes boards.
 */
export function PageSwitcher({ current, board }: { current: PageRef; board?: BoardFile | null }) {
  const index = useContentIndex()
  const dev = useDev()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<null | "new" | "rename">(null)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const boards = index.boards ?? []
  const docs = index.docs ?? []
  const currentBoard = current.kind === "board" ? boards.find((b) => b.id === current.id) : undefined
  const name = current.kind === "map" ? "Map" : current.kind === "docs" ? "Docs" : board?.title ?? currentBoard?.title ?? current.id

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close()
    window.addEventListener("pointerdown", onDown, true)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointerdown", onDown, true)
      window.removeEventListener("keydown", onKey)
    }
  }, [open])

  const close = () => {
    setOpen(false)
    setMode(null)
    setText("")
  }
  const go = (href: string) => {
    close()
    // Leave a bookmark: switching back lands where this page was looked at.
    const v = new URLSearchParams(location.search).get("v")
    if (v && current.kind !== "docs") rememberView(current.kind === "map" ? "map" : `b:${current.id}`, v)
    navigate(href)
  }

  const submit = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      if (mode === "new") {
        const id = await createBoard(t)
        go(boardHref(id))
      } else if (mode === "rename" && current.kind === "board") {
        await renameBoard(current.id, t, board ?? null)
        close()
      }
    } catch (e) {
      alert(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    if (current.kind !== "board") return
    if (!confirm(`Delete the board "${name}"? This removes stavy-content/boards/${current.id}.json.`)) return
    try {
      await removeBoard(current.id)
      go(mapHref())
    } catch (e) {
      alert(String((e as Error).message ?? e))
    }
  }

  return (
    <div ref={root} className="relative" data-ps-ui>
      <button
        type="button"
        className="ps-switch"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          if (open) return close()
          // The menu lives in the top layer (above the table of contents and every panel), anchored here.
          const r = e.currentTarget.getBoundingClientRect()
          setAt({ left: r.left - 6, top: r.bottom + 10 })
          setOpen(true)
        }}
      >
        <span className="truncate max-w-56">{name}</span>
        <ChevronDown className="ps-select-chevron" />
      </button>
      {open && at && (
        <StavyLayer>
        <div ref={menu} className="ps ps-menu ps-switch-menu" role="menu" style={{ left: at.left, top: at.top }}>
          <button type="button" role="menuitem" className="ps-menu-item" onClick={() => go(mapHref())}>
            <MapIcon className="ps-menu-icon" /> Map
            {current.kind === "map" && <Check className="ps-menu-check" />}
          </button>
          {boards.length > 0 && <div className="ps-menu-h">Boards</div>}
          {boards.map((b) => (
            <button key={b.id} type="button" role="menuitem" className="ps-menu-item" onClick={() => go(boardHref(b.id))} title={b.description}>
              <Presentation className="ps-menu-icon" /> <span className="truncate max-w-60">{b.title}</span>
              {current.kind === "board" && current.id === b.id && <Check className="ps-menu-check" />}
            </button>
          ))}
          <div className="ps-menu-sep" />
          <button type="button" role="menuitem" className="ps-menu-item" onClick={() => go(docHref(docs[0]?.id))}>
            <FileText className="ps-menu-icon" /> Docs
            {docs.length > 0 && <span className="ps-menu-count">{docs.length}</span>}
            {current.kind === "docs" && <Check className="ps-menu-check" />}
          </button>
          {dev?.writable && (
            <>
              <div className="ps-menu-sep" />
              {mode ? (
                <form
                  className="flex items-center gap-1 p-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void submit()
                  }}
                >
                  <input
                    autoFocus
                    className="ps-input"
                    placeholder={mode === "new" ? "Board title" : "New title"}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <button type="submit" className="ps-btn ps-btn-primary" disabled={!text.trim() || busy}>
                    {mode === "new" ? "Create" : "Rename"}
                  </button>
                </form>
              ) : (
                <>
                  <button type="button" role="menuitem" className="ps-menu-item" onClick={() => setMode("new")}>
                    <Plus className="ps-menu-icon" /> New board
                  </button>
                  {current.kind === "board" && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        className="ps-menu-item"
                        onClick={() => {
                          setText(name)
                          setMode("rename")
                        }}
                      >
                        <Pencil className="ps-menu-icon" /> Rename this board
                      </button>
                      <button type="button" role="menuitem" className="ps-menu-item ps-menu-danger" onClick={() => void del()}>
                        <Trash2 className="ps-menu-icon" /> Delete this board
                      </button>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
        </StavyLayer>
      )}
    </div>
  )
}
