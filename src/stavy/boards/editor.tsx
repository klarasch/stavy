import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"
import { cn } from "../cn"
import { useContentRev, writeContent, contentUrl } from "../dev"
import { isTyping } from "../chrome"
import type { PanZoomHandle } from "../canvas/PanZoom"
import type { BoardFile, BoardItem, SectionItem } from "../types"
import { arrowPath, ensureIds, findItem, freshId, allIds, isPlaced, layoutBoard, mapItems, siblingsOf, snap, walkItems, SECTION_PAD, type Box, type Sizes } from "./layout"
import { DEFAULT_W, FlowBody, ImageBody, MarkdownBody, MermaidBody, NoteBody, ScreenBody, StatesBody } from "./items"
import { Markdown, useMarkdownSource } from "./MarkdownView"
import type { NewItem } from "./Palette"
import { resolveShot } from "./resolve"

/**
 * The board editor, shared by boards (stavy-content/boards/<id>.json) and the
 * map's own layer (stavy-content/map.json): loading and live reloading, undo,
 * debounced saving, measuring and layout, selection, drag (8px grid, snaps to
 * neighbours' edges), resize, marquee, duplicate, delete, nudge, inline text
 * editing, and the rendered items with their arrows. The host owns the
 * PanZoom, the chrome and the hotkeys.
 *
 * `space` maps the file's coordinates to the canvas and back. Boards use the
 * identity; the map anchors each item to the area it sits on, so it travels
 * with that screen when the map's layout changes.
 */

const SNAP_PX = 6
const HISTORY = 100

/** Width an item renders at, before measuring: its own `w`, else a per-type default. Null = intrinsic. */
export function itemWidth(it: BoardItem): number | null {
  switch (it.type) {
    case "screen":
      if (it.w) return it.w
      if (it.crop) {
        const shot = resolveShot(it.screen, it)
        if (shot?.entry) return Math.max(200, Math.min(640, Math.round(shot.entry.width)))
        return DEFAULT_W.crop
      }
      return DEFAULT_W.screen
    case "markdown":
      return it.w ?? DEFAULT_W.markdown
    case "note":
      return it.w ?? DEFAULT_W.note
    case "image":
      return it.w ?? DEFAULT_W.image
    case "mermaid":
      return it.w ?? DEFAULT_W.mermaid
    case "states":
    case "flow":
      return it.w ?? null
    default:
      return null
  }
}

const RESIZE_H = new Set(["section", "note", "markdown"])

export type Editing = { id: string; field: "text" | "title" } | null

/** File coordinates ↔ canvas coordinates. */
export interface BoardSpace {
  toView: (items: BoardItem[]) => BoardItem[]
  fromView: (items: BoardItem[]) => BoardItem[]
}
const IDENTITY: BoardSpace = { toView: (i) => i, fromView: (i) => i }

async function loadContentJson(file: string, fallback?: BoardFile): Promise<BoardFile> {
  const r = await fetch(contentUrl(file), { cache: "no-store" })
  if (r.status === 404 && fallback) return fallback
  if (!r.ok) throw new Error(`${file} → ${r.status}`)
  return (await r.json()) as BoardFile
}

export function useBoardEditor({
  file,
  editMode,
  wireframe,
  pz,
  contentElRef,
  space = IDENTITY,
  extraBoxes,
  fallback,
}: {
  /** Path inside stavy-content, e.g. "boards/intro.json" */
  file: string
  editMode: boolean
  wireframe: boolean
  pz: RefObject<PanZoomHandle | null>
  /** The PanZoom content element: screen ↔ canvas conversions */
  contentElRef: RefObject<HTMLDivElement | null>
  space?: BoardSpace
  /** Boxes outside the board that arrows may point at (the map's screens), in canvas coordinates */
  extraBoxes?: Record<string, Box>
  /** Used when the file doesn't exist yet (the map's layer starts empty) */
  fallback?: BoardFile
}) {
  const rev = useContentRev()

  /* ---------------- board state, history, saving ---------------- */

  // `stored` is the file as written; `board` is the same in canvas coordinates.
  const [stored, setStored] = useState<BoardFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const board = useMemo(() => (stored ? { ...stored, items: space.toView(stored.items) } : null), [stored, space])
  const toFile = useCallback((b: BoardFile): BoardFile => ({ ...b, items: space.fromView(b.items) }), [space])
  const setBoardState = useCallback((b: BoardFile | null) => setStored(b && toFile(b)), [toFile])
  const boardRef = useRef<BoardFile | null>(null)
  boardRef.current = board
  const undo = useRef<BoardFile[]>([])
  const redo = useRef<BoardFile[]>([])
  const [, setHist] = useState(0)
  const lastSaved = useRef<string>("")
  const saveT = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saveState, setSaveState] = useState<"idle" | "saved" | "saving" | "error">("idle")
  const busy = useRef(false) // mid-drag / resize / text edit: hold live reloads

  const save = useCallback(
    (b: BoardFile) => {
      if (saveT.current) clearTimeout(saveT.current)
      setSaveState("saving")
      saveT.current = setTimeout(async () => {
        saveT.current = null
        const out = toFile(b)
        const json = JSON.stringify(out)
        try {
          await writeContent(file, out)
          lastSaved.current = json
          setSaveState("saved")
        } catch {
          setSaveState("error")
        }
      }, 400)
    },
    [file, toFile]
  )

  /** Apply an edit: history + debounced save. `base` is what undo returns to (default: the current board). */
  const commit = useCallback(
    (next: BoardFile, base?: BoardFile) => {
      const prev = base ?? boardRef.current
      if (prev) {
        undo.current = [...undo.current.slice(-HISTORY + 1), prev]
        redo.current = []
        setHist((n) => n + 1)
      }
      setBoardState(next)
      save(next)
    },
    [save]
  )

  // Load, and re-load when the file changes on disk (an agent edited it) —
  // unless the user is mid-gesture or has a save pending.
  useEffect(() => {
    let cancelled = false
    undo.current = []
    redo.current = []
    setStored(null)
    setError(null)
    loadContentJson(file, fallback).then(
      (b) => {
        if (cancelled) return
        const fixed = { ...b, items: ensureIds(b.items ?? []) }
        lastSaved.current = JSON.stringify(b)
        setStored(fixed)
      },
      (e: unknown) => !cancelled && setError(String((e as Error)?.message ?? e))
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])
  useEffect(() => {
    if (!rev || !boardRef.current) return
    if (busy.current || saveT.current) return
    let cancelled = false
    loadContentJson(file, fallback).then(
      (b) => {
        if (cancelled || busy.current || saveT.current) return
        const json = JSON.stringify(b)
        if (json === lastSaved.current) return
        lastSaved.current = json
        setStored({ ...b, items: ensureIds(b.items ?? []) })
      },
      () => {}
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, file])
  useEffect(() => () => void (saveT.current && clearTimeout(saveT.current)), [])

  const doUndo = () => {
    const prev = undo.current.pop()
    if (!prev || !boardRef.current) return
    redo.current.push(boardRef.current)
    setBoardState(prev)
    save(prev)
    setHist((n) => n + 1)
  }
  const doRedo = () => {
    const next = redo.current.pop()
    if (!next || !boardRef.current) return
    undo.current.push(boardRef.current)
    setBoardState(next)
    save(next)
    setHist((n) => n + 1)
  }

  /* ---------------- selection ---------------- */

  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Editing>(null)
  useEffect(() => {
    if (!editMode) {
      setSelection(new Set())
      setEditing(null)
    }
  }, [editMode])
  // Flow strips can collapse to a list (a viewing choice; in edit mode also written to the file). Sections are plain frames.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggleCollapsed = (it: BoardItem) => {
    const cur = collapsed[it.id] ?? !!(it as { collapsed?: boolean }).collapsed
    setCollapsed((c) => ({ ...c, [it.id]: !cur }))
    if (editMode && board) commit({ ...board, items: mapItems(board.items, (x) => (x.id === it.id ? ({ ...x, collapsed: !cur } as BoardItem) : x)) })
  }

  /* ---------------- measuring + layout ---------------- */

  const [sizes, setSizes] = useState<Sizes>({})
  const ro = useRef<ResizeObserver | null>(null)
  const pending = useRef<Sizes>({})
  const flushT = useRef<number | null>(null)
  if (!ro.current && typeof ResizeObserver !== "undefined") {
    ro.current = new ResizeObserver((entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement
        const iid = el.dataset.itemId
        if (!iid) continue
        pending.current[iid] = { w: el.offsetWidth, h: el.offsetHeight }
      }
      if (flushT.current == null)
        flushT.current = requestAnimationFrame(() => {
          flushT.current = null
          const p = pending.current
          pending.current = {}
          setSizes((s) => {
            let changed = false
            for (const [k, v] of Object.entries(p)) if (!s[k] || Math.abs(s[k].w - v.w) > 0.5 || Math.abs(s[k].h - v.h) > 0.5) changed = true
            return changed ? { ...s, ...p } : s
          })
        })
    })
  }
  useEffect(() => () => ro.current?.disconnect(), [])
  const measure = useCallback((el: HTMLElement | null) => {
    if (el) ro.current?.observe(el)
  }, [])

  const viewItems = useMemo(() => {
    if (!board) return []
    if (!Object.keys(collapsed).length) return board.items
    return mapItems(board.items, (it) => (it.id in collapsed ? ({ ...it, collapsed: collapsed[it.id] } as BoardItem) : it))
  }, [board, collapsed])
  const layout = useMemo(() => layoutBoard(viewItems, sizes, board?.layout ?? {}), [viewItems, sizes, board?.layout])

  /** Screen point → board coordinates. */
  const toBoard = (cx: number, cy: number) => {
    const tr = pz.current?.get() ?? { x: 0, y: 0, k: 1 }
    const vp = contentElRef.current?.parentElement?.getBoundingClientRect()
    return { x: (cx - (vp?.left ?? 0) - tr.x) / tr.k, y: (cy - (vp?.top ?? 0) - tr.y) / tr.k }
  }

  /* ---------------- editing operations ---------------- */

  /** Give every unplaced sibling of the moved items its current position, so nothing reflows under the user's hand. */
  const freeze = (items: BoardItem[], moving: Set<string>): BoardItem[] => {
    const lists = new Set<BoardItem[]>()
    for (const mid of moving) {
      const sib = siblingsOf(items, mid)
      if (sib) lists.add(sib)
    }
    const freezeIds = new Set<string>()
    for (const l of lists) for (const it of l) if (it.type !== "arrow" && !isPlaced(it) && layout.local[it.id]) freezeIds.add(it.id)
    return mapItems(items, (it) => (freezeIds.has(it.id) ? ({ ...it, x: layout.local[it.id].x, y: layout.local[it.id].y } as BoardItem) : it))
  }

  const removeSelected = () => {
    if (!board || !selection.size) return
    const gone = new Set<string>()
    for (const sid of selection) {
      const it = findItem(board.items, sid)
      if (it) walkItems([it], (x) => gone.add(x.id))
    }
    commit({ ...board, items: mapItems(board.items, (it) => (gone.has(it.id) || (it.type === "arrow" && (gone.has(it.from) || gone.has(it.to))) ? null : it)) })
    setSelection(new Set())
  }

  const duplicateSelected = () => {
    if (!board || !selection.size) return
    const taken = allIds(board.items)
    const made: string[] = []
    const clone = (it: BoardItem): BoardItem => {
      const c = JSON.parse(JSON.stringify(it)) as BoardItem
      const reid = (x: BoardItem) => {
        x.id = freshId(x.type, taken)
        if (x.type === "section") (x.items ?? []).forEach(reid)
      }
      reid(c)
      return c
    }
    const insert = (items: BoardItem[]): BoardItem[] =>
      items.flatMap((it) => {
        const inner = it.type === "section" && it.items ? ({ ...it, items: insert(it.items) } as BoardItem) : it
        if (!selection.has(it.id) || it.type === "arrow") return [inner]
        const c = clone(it)
        const b = layout.local[it.id]
        if (b && c.type !== "arrow") Object.assign(c, { x: snap(b.x + 24), y: snap(b.y + 24) })
        made.push(c.id)
        return [inner, c]
      })
    commit({ ...board, items: insert(board.items) })
    setSelection(new Set(made))
  }

  const nudge = (dx: number, dy: number) => {
    if (!board || !selection.size) return
    const frozen = freeze(board.items, selection)
    commit({
      ...board,
      items: mapItems(frozen, (it) =>
        selection.has(it.id) && it.type !== "arrow" ? ({ ...it, x: (it.x ?? layout.local[it.id]?.x ?? 0) + dx, y: (it.y ?? layout.local[it.id]?.y ?? 0) + dy } as BoardItem) : it
      ),
    })
  }

  const addItem = (draft: NewItem) => {
    if (!board) return
    const taken = allIds(board.items)
    const item = { ...draft, id: freshId(String(draft.type), taken) } as BoardItem
    // Into the selected section, laid out by it; otherwise at the middle of the screen.
    const target = selection.size === 1 ? findItem(board.items, [...selection][0]) : undefined
    if (target?.type === "section") {
      commit({ ...board, items: mapItems(board.items, (it) => (it.id === target.id ? ({ ...it, items: [...((it as SectionItem).items ?? []), item] } as BoardItem) : it)) })
    } else {
      const c = toBoard(window.innerWidth / 2, window.innerHeight / 2)
      const w = itemWidth(item) ?? 400
      // Mid-screen, stepping down-right past anything already there, so a burst of additions never stacks.
      let x = snap(c.x - w / 2)
      let y = snap(c.y - 80)
      const boxes = board.items.filter((i) => i.type !== "arrow").map((i) => layout.local[i.id]).filter(Boolean)
      for (let n = 0; n < 40 && boxes.some((b) => x >= b.x - 8 && x < b.x + b.w && y >= b.y - 8 && y < b.y + b.h); n++) {
        const hit = boxes.find((b) => x >= b.x - 8 && x < b.x + b.w && y >= b.y - 8 && y < b.y + b.h)!
        x = snap(hit.x + hit.w + 32)
      }
      Object.assign(item, { x, y })
      commit({ ...board, items: [...board.items, item] })
    }
    setSelection(new Set([item.id]))
    if (item.type === "note" || item.type === "markdown") setEditing({ id: item.id, field: "text" })
  }

  const setItem = (iid: string, patch: Record<string, unknown>) => {
    if (!board) return
    commit({ ...board, items: mapItems(board.items, (it) => (it.id === iid ? ({ ...it, ...patch } as BoardItem) : it)) })
  }

  /* ---------------- pointer: drag, resize, marquee ---------------- */

  const gesture = useRef<
    | null
    | {
        kind: "move" | "resize"
        ids: string[]
        sx: number
        sy: number
        base: BoardFile
        /** The board before the gesture (before freezing), what undo returns to */
        start: BoardFile
        origin: Record<string, Box>
        moved: boolean
        pointerId: number
      }
  >(null)
  const [guides, setGuides] = useState<{ x?: number; y?: number } | null>(null)

  const startMove = (e: React.PointerEvent, it: BoardItem) => {
    if (!board || e.button !== 0) return
    e.stopPropagation()
    let sel = selection
    if (e.shiftKey) {
      sel = new Set(selection)
      if (sel.has(it.id)) sel.delete(it.id)
      else sel.add(it.id)
      setSelection(sel)
      if (!sel.has(it.id)) return
    } else if (!selection.has(it.id)) {
      sel = new Set([it.id])
      setSelection(sel)
    }
    if (editing && editing.id !== it.id) setEditing(null)
    const ids = [...sel].filter((x) => layout.local[x])
    gesture.current = {
      kind: "move",
      ids,
      sx: e.clientX,
      sy: e.clientY,
      base: board,
      start: board,
      origin: Object.fromEntries(ids.map((x) => [x, layout.local[x]])),
      moved: false,
      pointerId: e.pointerId,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const startResize = (e: React.PointerEvent, it: BoardItem) => {
    if (!board || e.button !== 0) return
    e.stopPropagation()
    gesture.current = {
      kind: "resize",
      ids: [it.id],
      sx: e.clientX,
      sy: e.clientY,
      base: board,
      start: board,
      origin: { [it.id]: layout.local[it.id] },
      moved: false,
      pointerId: e.pointerId,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onGestureMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const k = pz.current?.get().k ?? 1
    let dx = (e.clientX - g.sx) / k
    let dy = (e.clientY - g.sy) / k
    if (!g.moved) {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 3) return
      g.moved = true
      busy.current = true
      if (g.kind === "move") g.base = { ...g.base, items: freeze(g.base.items, new Set(g.ids)) }
    }
    if (g.kind === "resize") {
      const iid = g.ids[0]
      const o = g.origin[iid]
      const it = findItem(g.base.items, iid)
      if (!it) return
      const patch: Record<string, number> = { w: Math.max(120, snap(o.w + dx)) }
      if (RESIZE_H.has(it.type)) patch.h = Math.max(it.type === "section" ? 120 : 60, snap(o.h + dy))
      setBoardState({ ...g.base, items: mapItems(g.base.items, (x) => (x.id === iid ? ({ ...x, ...patch } as BoardItem) : x)) })
      return
    }
    // Snap the lead item to the 8px grid, then to its neighbours' edges when close.
    const lead = g.origin[g.ids[0]]
    const sibs = (siblingsOf(g.base.items, g.ids[0]) ?? []).filter((s) => s.type !== "arrow" && !g.ids.includes(s.id) && layout.local[s.id])
    const tol = SNAP_PX / k
    /** Snap one axis: raw position + own size against the neighbours' edges; else the grid. */
    const snapAxis = (raw: number, size: number, edges: number[]): { v: number; guide?: number } => {
      let best = tol
      let out: { v: number; guide?: number } = { v: snap(raw) }
      for (const edge of edges)
        for (const off of [0, size]) {
          const d = Math.abs(raw + off - edge)
          if (d < best) {
            best = d
            out = { v: edge - off, guide: edge }
          }
        }
      return out
    }
    const sx = snapAxis(lead.x + dx, lead.w, sibs.flatMap((s) => [layout.local[s.id].x, layout.local[s.id].x + layout.local[s.id].w]))
    const sy = snapAxis(lead.y + dy, lead.h, sibs.flatMap((s) => [layout.local[s.id].y, layout.local[s.id].y + layout.local[s.id].h]))
    const gx = sx.guide
    const gy = sy.guide
    dx = sx.v - lead.x
    dy = sy.v - lead.y
    // Guides are drawn in the lead item's parent coordinates; convert to board space.
    const parentOff = parentOffset(g.base.items, g.ids[0])
    setGuides(gx != null || gy != null ? { x: gx != null ? gx + parentOff.x : undefined, y: gy != null ? gy + parentOff.y : undefined } : null)
    setBoardState({
      ...g.base,
      items: mapItems(g.base.items, (x) => (g.origin[x.id] && x.type !== "arrow" ? ({ ...x, x: g.origin[x.id].x + dx, y: g.origin[x.id].y + dy } as BoardItem) : x)),
    })
  }

  const parentOffset = (items: BoardItem[], iid: string): { x: number; y: number } => {
    let off = { x: 0, y: 0 }
    walkItems(items, (it, parent) => {
      if (it.id === iid && parent) {
        const pb = layout.abs[parent.id]
        if (pb) off = { x: pb.x + SECTION_PAD.side, y: pb.y + SECTION_PAD.top }
      }
    })
    return off
  }

  const onGestureEnd = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    setGuides(null)
    busy.current = false
    if ((e.currentTarget as HTMLElement).hasPointerCapture?.(g.pointerId)) (e.currentTarget as HTMLElement).releasePointerCapture(g.pointerId)
    if (g.moved && boardRef.current) {
      // Swallow the click that ends a drag (a card would otherwise open the player).
      const stop = (ev: Event) => {
        ev.stopPropagation()
        ev.preventDefault()
      }
      window.addEventListener("click", stop, { capture: true, once: true })
      setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0)
      commit(boardRef.current, g.start)
    }
  }

  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (!editMode || !e.shiftKey || e.button !== 0) return
    const tgt = e.target as HTMLElement
    if (tgt.closest("[data-item-id], [data-ps-ui]")) return
    e.stopPropagation()
    setMarquee({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onBackgroundPointerMove = (e: React.PointerEvent) => {
    if (marquee) setMarquee({ ...marquee, x1: e.clientX, y1: e.clientY })
  }
  const marqueeEnded = useRef(false)
  const onBackgroundPointerUp = () => {
    if (!marquee) return
    const a = toBoard(Math.min(marquee.x0, marquee.x1), Math.min(marquee.y0, marquee.y1))
    const b = toBoard(Math.max(marquee.x0, marquee.x1), Math.max(marquee.y0, marquee.y1))
    const hit = new Set(selection)
    for (const [iid, box] of Object.entries(layout.abs)) {
      if (box.x < b.x && box.x + box.w > a.x && box.y < b.y && box.y + box.h > a.y) {
        // Prefer whole sections over their children when both are inside.
        hit.add(iid)
      }
    }
    if (board)
      walkItems(board.items, (it, parent) => {
        if (parent && hit.has(parent.id)) hit.delete(it.id)
      })
    setSelection(hit)
    setMarquee(null)
    marqueeEnded.current = true
    setTimeout(() => (marqueeEnded.current = false), 50)
  }

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || !editMode) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && key === "z") {
        e.preventDefault()
        e.shiftKey ? doRedo() : doUndo()
      } else if (mod && key === "y") {
        e.preventDefault()
        doRedo()
      } else if (mod && key === "d") {
        e.preventDefault()
        duplicateSelected()
      } else if (mod && key === "a") {
        e.preventDefault()
        if (board) setSelection(new Set(board.items.filter((i) => i.type !== "arrow").map((i) => i.id)))
      } else if (!mod && (e.key === "Delete" || e.key === "Backspace") && selection.size) {
        e.preventDefault()
        removeSelected()
      } else if (!mod && e.key.startsWith("Arrow") && selection.size) {
        e.preventDefault()
        const step = e.shiftKey ? 32 : 8
        nudge(e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0)
      } else if (!mod && e.key === "Enter" && selection.size === 1) {
        const it = board && findItem(board.items, [...selection][0])
        if (it && (it.type === "note" || it.type === "markdown")) {
          e.preventDefault()
          setEditing({ id: it.id, field: "text" })
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  /* ---------------- render ---------------- */

  const renderItems = (items: BoardItem[]) =>
    items.map((it) => {
      if (it.type === "arrow") return null
      const box = layout.local[it.id]
      if (!box) return null
      const selected = selection.has(it.id)
      const common = {
        item: it,
        box,
        editMode,
        selected,
        single: selected && selection.size === 1,
        onMove: startMove,
        onResize: startResize,
        onGestureMove,
        onGestureEnd,
        editing: editing?.id === it.id ? editing.field : null,
        setEditing: (f: "text" | "title" | null) => setEditing(f ? { id: it.id, field: f } : null),
        onPatch: (patch: Record<string, unknown>) => setItem(it.id, patch),
      }
      if (it.type === "section") {
        return (
          <SectionFrame key={it.id} {...common} measure={measure}>
            {renderItems(it.items ?? [])}
          </SectionFrame>
        )
      }
      return (
        <ItemFrame key={it.id} {...common} measure={measure} width={itemWidth(it)}>
          <ItemBody item={it} width={itemWidth(it) ?? box.w} wireframe={wireframe} collapsed={!!(it as { collapsed?: boolean }).collapsed} onToggle={() => toggleCollapsed(it)} />
        </ItemFrame>
      )
    })

  const arrows = useMemo(() => {
    const out: Array<{ id: string; d: string; mid: { x: number; y: number }; label?: string; dashed: boolean; end: ReturnType<typeof arrowPath>["end"] }> = []
    walkItems(viewItems, (it) => {
      if (it.type !== "arrow") return
      const a = layout.abs[it.from] ?? extraBoxes?.[it.from]
      const b = layout.abs[it.to] ?? extraBoxes?.[it.to]
      if (!a || !b) return
      const p = arrowPath(a, b)
      out.push({ id: it.id, ...p, label: it.label, dashed: it.style === "dashed" })
    })
    return out
  }, [viewItems, layout, extraBoxes])

  /** Arrows, items, arrow labels and snap guides, for the PanZoom content. */
  const layer = (
    <>
      <svg className="ps-board-arrows" width={1} height={1} aria-hidden>
        <defs>
          <marker id="ps-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" />
          </marker>
        </defs>
        {arrows.map((a) => (
          <path key={a.id} d={a.d} className={cn("ps-board-arrow", a.dashed && "is-dashed")} markerEnd="url(#ps-arrowhead)" />
        ))}
      </svg>
      {renderItems(viewItems)}
      {arrows.filter((a) => a.label).map((a) => (
        <div key={a.id} className="ps-arrow-label" style={{ left: a.mid.x, top: a.mid.y }}>
          <span className="ps-zl">{a.label}</span>
        </div>
      ))}
      {guides?.x != null && <div className="ps-guide ps-guide-v" style={{ left: guides.x }} />}
      {guides?.y != null && <div className="ps-guide ps-guide-h" style={{ top: guides.y }} />}
    </>
  )

  /** The marquee rectangle, in screen coordinates (outside the PanZoom). */
  const marqueeEl = marquee && (
    <div
      className="ps-marquee"
      style={{
        left: Math.min(marquee.x0, marquee.x1),
        top: Math.min(marquee.y0, marquee.y1),
        width: Math.abs(marquee.x1 - marquee.x0),
        height: Math.abs(marquee.y1 - marquee.y0),
      }}
    />
  )

  /** Spread on the element around the PanZoom: marquee (⇧ drag) and click-to-deselect. */
  const background = {
    onPointerDownCapture: onBackgroundPointerDown,
    onPointerMove: onBackgroundPointerMove,
    onPointerUp: onBackgroundPointerUp,
    onClick: (e: React.MouseEvent) => {
      if (!editMode) return
      // The click that ends a marquee must not clear what it just selected.
      if (marqueeEnded.current) return void (marqueeEnded.current = false)
      const tgt = e.target as HTMLElement
      if (!tgt.closest("[data-item-id], [data-ps-ui]")) {
        setSelection(new Set())
        setEditing(null)
      }
    },
  }

  return {
    board,
    error,
    commit,
    layout,
    sizes,
    selection,
    setSelection,
    editing,
    setEditing,
    addItem,
    doUndo,
    doRedo,
    canUndo: undo.current.length > 0,
    canRedo: redo.current.length > 0,
    saveState,
    layer,
    marqueeEl,
    background,
  }
}

/* ------------------------------------------------------------------ */

export function InlineInput({ value, className, onDone }: { value: string; className?: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value)
  return (
    <input
      autoFocus
      className={cn("ps-inline-input", className)}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => onDone(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(v)
        if (e.key === "Escape") onDone(null)
        e.stopPropagation()
      }}
    />
  )
}

interface FrameProps {
  item: BoardItem
  box: Box
  editMode: boolean
  selected: boolean
  single: boolean
  editing: "text" | "title" | null
  setEditing: (f: "text" | "title" | null) => void
  onPatch: (patch: Record<string, unknown>) => void
  onMove: (e: React.PointerEvent, it: BoardItem) => void
  onResize: (e: React.PointerEvent, it: BoardItem) => void
  onGestureMove: (e: React.PointerEvent) => void
  onGestureEnd: (e: React.PointerEvent) => void
  measure: (el: HTMLElement | null) => void
  children: React.ReactNode
}

/** Shared by items and sections: the edit-mode shield, selection ring and resize handle. */
function EditChrome({ item, editMode, selected, single, onMove, onResize, onGestureMove, onGestureEnd, setEditing }: FrameProps) {
  if (!editMode) return null
  const textual = item.type === "note" || item.type === "markdown"
  return (
    <>
      {/* The shield: in edit mode a click selects and a drag moves, nothing inside reacts. */}
      <div
        className="ps-item-shield"
        onPointerDown={(e) => onMove(e, item)}
        onPointerMove={onGestureMove}
        onPointerUp={onGestureEnd}
        onPointerCancel={onGestureEnd}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setEditing(textual ? "text" : "title")
        }}
      />
      {selected && <div className="ps-item-ring" />}
      {single && (
        <div
          className="ps-item-handle"
          title="Resize"
          onPointerDown={(e) => onResize(e, item)}
          onPointerMove={onGestureMove}
          onPointerUp={onGestureEnd}
          onPointerCancel={onGestureEnd}
        />
      )}
    </>
  )
}

const ItemFrame = memo(function ItemFrame(props: FrameProps & { width: number | null }) {
  const { item, box, editMode, editing, setEditing, onPatch, measure, width, children } = props
  const it = item as Exclude<BoardItem, { type: "arrow" }>
  const minH = RESIZE_H.has(it.type) && it.h ? it.h : undefined
  const caption = it.title ?? (it.type === "screen" ? defaultCaption(it) : undefined)
  // Markdown and notes keep their text selectable outside edit mode: a press on text must not pan.
  const keepText = (e: React.PointerEvent) => {
    if (!editMode && (e.target as HTMLElement).closest(".ps-md")) e.stopPropagation()
  }
  return (
    <div
      ref={measure}
      data-item-id={it.id}
      data-item-type={it.type}
      className={cn("ps-item", editMode && "is-editable")}
      style={{ left: box.x, top: box.y, width: width ?? undefined, minHeight: minH }}
      onPointerDown={keepText}
    >
      {editing === "title" ? (
        <InlineInput
          value={it.title ?? ""}
          className="ps-item-title"
          onDone={(v) => {
            setEditing(null)
            if (v != null && v !== (it.title ?? "")) onPatch({ title: v.trim() || undefined })
          }}
        />
      ) : (
        caption && (
          <div className={cn("ps-item-title", !it.title && "is-default")}>
            <span className="ps-zs">{caption}</span>
          </div>
        )
      )}
      {editing === "text" && (it.type === "note" || it.type === "markdown") ? <TextEditor item={it} onPatch={onPatch} onDone={() => setEditing(null)} /> : children}
      {it.note && it.type !== "note" && (
        <div className="ps-item-note">
          <Markdown md={it.note} inline />
        </div>
      )}
      <EditChrome {...props} />
    </div>
  )
})

function defaultCaption(it: Extract<BoardItem, { type: "screen" }>): string | undefined {
  const shot = resolveShot(it.screen, it)
  if (!shot) return undefined
  return shot.label === shot.page.label ? shot.page.label : `${shot.page.label} · ${shot.label}`
}

/** Inline text editing for notes and Markdown (a `src` file is edited and saved in place). */
function TextEditor({ item, onPatch, onDone }: { item: Extract<BoardItem, { type: "note" | "markdown" }>; onPatch: (p: Record<string, unknown>) => void; onDone: () => void }) {
  const src = item.type === "markdown" && item.md == null ? item.src : undefined
  const loaded = useMarkdownSource(src)
  const initial = item.type === "note" ? item.text : item.md ?? loaded.text
  const [v, setV] = useState<string | null>(initial ?? null)
  useEffect(() => {
    if (v == null && initial != null) setV(initial)
  }, [initial, v])
  const ref = useRef<HTMLTextAreaElement>(null)
  // Focus once the text is there — and after whatever opened the editor (a menu) let go of focus.
  const ready = v != null
  useEffect(() => {
    if (!ready) return
    const id = requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
    return () => cancelAnimationFrame(id)
  }, [ready])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight + 2}px`
  }, [v])
  const finish = async (keep: boolean) => {
    onDone()
    if (!keep || v == null || v === initial) return
    if (item.type === "note") onPatch({ text: v })
    else if (src) {
      const file = src.split("#")[0]
      if (src.includes("#")) return // a section of a larger file: edit the file itself
      await writeContent(file, v)
    } else onPatch({ md: v })
  }
  if (v == null) return <div className="ps-skeleton" style={{ height: 80 }} />
  return (
    <textarea
      ref={ref}
      autoFocus
      className={cn("ps-text-editor", item.type === "note" && "is-note")}
      data-color={item.type === "note" ? item.color ?? "yellow" : undefined}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => void finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Escape") void finish(false)
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void finish(true)
      }}
    />
  )
}

const SectionFrame = memo(function SectionFrame(props: FrameProps) {
  const { item, box, editMode, editing, setEditing, onPatch, children } = props
  const s = item as SectionItem
  return (
    <div data-item-id={s.id} data-item-type="section" data-toc={`section:${s.id}`} className={cn("ps-section", editMode && "is-editable")} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
      <EditChrome {...props} />
      <div className="ps-section-title" data-ps-ui>
        <span className="ps-section-pill">
          {editing === "title" ? (
            <InlineInput
              value={s.title}
              onDone={(v) => {
                setEditing(null)
                if (v != null && v.trim() && v !== s.title) onPatch({ title: v.trim() })
              }}
            />
          ) : (
            <span onDoubleClick={(e) => editMode && (e.stopPropagation(), setEditing("title"))}>{s.title}</span>
          )}
          {s.note && (
            <span className="ps-section-note">
              <Markdown md={s.note} inline />
            </span>
          )}
        </span>
      </div>
      <div className="ps-section-body" style={{ left: SECTION_PAD.side, top: SECTION_PAD.top }}>
        {children}
      </div>
    </div>
  )
})

const ItemBody = memo(function ItemBody({
  item,
  width,
  wireframe,
  collapsed,
  onToggle,
}: {
  item: BoardItem
  width: number
  wireframe: boolean
  collapsed: boolean
  onToggle: () => void
}) {
  switch (item.type) {
    case "screen":
      return <ScreenBody item={item} width={width} wireframe={wireframe} />
    case "states":
      return <StatesBody item={item} wireframe={wireframe} />
    case "flow":
      return <FlowBody item={item} wireframe={wireframe} collapsed={collapsed} onToggle={onToggle} />
    case "markdown":
      return <MarkdownBody item={item} />
    case "note":
      return <NoteBody item={item} />
    case "image":
      return <ImageBody item={item} width={width} />
    case "mermaid":
      return <MermaidBody item={item} />
    default:
      return <div className="ps-board-missing">Unknown item type “{(item as { type: string }).type}”</div>
  }
})

