import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { Sun, Moon, SunMoon, ChevronDown, Check, Eye, EyeOff, Keyboard } from "lucide-react"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/* Chrome state: theme (independent from the prototype) + hide/show UI */
/* ------------------------------------------------------------------ */

export type PsTheme = "system" | "light" | "dark"

interface ChromeState {
  theme: PsTheme
  setTheme: (t: PsTheme) => void
  hidden: boolean
  setHidden: (v: boolean) => void
  help: boolean
  setHelp: (v: boolean) => void
}

/** True when the keyboard event originates from a text field — hotkeys must stay out of the way. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
}

/**
 * Single-key hotkeys (no modifier) for viewer modes. Keys are matched on
 * `e.key` lower-cased, so they are layout-independent for letters; special
 * keys use their name ("Escape", "ArrowRight", "?").
 */
export function useHotkeys(bindings: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(bindings)
  ref.current = bindings
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const fn = ref.current[key] ?? ref.current[e.key]
      if (fn) {
        e.preventDefault()
        fn(e)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [enabled])
}

const Ctx = createContext<ChromeState | null>(null)

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
export const HIDE_KEY_LABEL = isMac ? ["⌘", "\\"] : ["Ctrl", "\\"]
export const HIDE_KEY_ALT = ["⇧", "H"]

export function ChromeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<PsTheme>(
    () => (localStorage.getItem("ps-theme") as PsTheme | null) ?? "system"
  )
  const [hidden, setHidden] = useState(() => new URLSearchParams(window.location.search).get("ui") === "0")
  const [help, setHelp] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute("data-ps-theme", theme)
    localStorage.setItem("ps-theme", theme)
  }, [theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      // Match the *physical* key so it works on every keyboard layout
      // (on many European layouts "\" is not a plain key).
      const backslash = e.code === "Backslash" || e.key === "\\"
      if ((e.metaKey || e.ctrlKey) && backslash) {
        e.preventDefault()
        setHidden((h) => !h)
        return
      }
      // Layout-proof fallback: Shift+H when not typing.
      if (!typing && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.code === "KeyH") {
        e.preventDefault()
        setHidden((h) => !h)
        return
      }
      if (!typing && e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setHelp((h) => !h)
        return
      }
      if (e.key === "Escape") {
        setHelp((h) => {
          if (h) e.stopImmediatePropagation()
          return false
        })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return <Ctx.Provider value={{ theme, setTheme, hidden, setHidden, help, setHelp }}>{children}</Ctx.Provider>
}

export function useChrome(): ChromeState {
  const c = useContext(Ctx)
  if (!c) throw new Error("useChrome must be used inside <ChromeProvider>")
  return c
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** A run of keycaps, e.g. <Keys keys={["⌘", "\\"]} /> */
export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((k, i) => (
        <Kbd key={i}>{k}</Kbd>
      ))}
    </span>
  )
}

function TipBubble({ x, y, below, label, keys }: { x: number; y: number; below: boolean; label: string; keys?: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(x)
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0
    setLeft(Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8)))
  }, [x, label])
  return (
    <div
      ref={ref}
      className="ps ps-tipbubble"
      style={below ? { left, top: y } : { left, bottom: window.innerHeight - y }}
    >
      <span>{label}</span>
      {keys && keys.length > 0 && <Keys keys={keys} />}
    </div>
  )
}

/**
 * Tooltip: appears after a short delay, rendered in a portal and clamped to
 * the viewport so it never clips at the screen edge. Shortcuts render as keycaps.
 */
export function Tip({ label, keys, below, children }: { label: string; keys?: string[]; below?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null)
  const show = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      // Prefer the requested side, but flip when there's no room (e.g. toolbar docked at the top).
      let side = below ? "below" : "above"
      if (side === "above" && r.top - 44 < 0) side = "below"
      if (side === "below" && r.bottom + 44 > window.innerHeight) side = "above"
      setPos({ x: r.left + r.width / 2, y: side === "below" ? r.bottom + 8 : r.top - 8, below: side === "below" })
    }, 320)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setPos(null)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <span ref={ref} className="inline-flex" onMouseEnter={show} onMouseLeave={hide} onMouseDown={hide}>
      {children}
      {pos && createPortal(<TipBubble x={pos.x} y={pos.y} below={pos.below} label={label} keys={keys} />, document.body)}
    </span>
  )
}

export function PsButton({
  active,
  icon,
  primary,
  className,
  tip,
  keys,
  tipBelow,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
  icon?: boolean
  primary?: boolean
  /** Tooltip label */
  tip?: string
  /** Shortcut keycaps shown in the tooltip */
  keys?: string[]
  tipBelow?: boolean
}) {
  const btn = (
    <button
      type="button"
      className={cn("ps-btn", icon && "ps-icon", primary && "ps-btn-primary", className)}
      data-active={active ? "true" : undefined}
      {...props}
    />
  )
  if (!tip) return btn
  return (
    <Tip label={tip} keys={keys} below={tipBelow}>
      {btn}
    </Tip>
  )
}

export const PsDivider = () => <span className="ps-divider" aria-hidden />

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ps-kbd">{children}</kbd>
}

export function Chip({
  children,
  accent,
  sm,
  className,
  mono,
  title,
}: {
  children: ReactNode
  accent?: boolean
  sm?: boolean
  mono?: boolean
  className?: string
  title?: string
}) {
  return (
    <span title={title} className={cn("ps-chip", sm && "ps-chip-sm", accent && "ps-chip-accent", mono && "ps-mono", className)}>
      {children}
    </span>
  )
}

export function ThemeToggle({ tipBelow }: { tipBelow?: boolean }) {
  const { theme, setTheme } = useChrome()
  const next: Record<PsTheme, PsTheme> = { system: "light", light: "dark", dark: "system" }
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : SunMoon
  const label = theme === "system" ? "Theme: Auto (follows your system)" : `Theme: ${theme === "light" ? "Light" : "Dark"}`
  return (
    <PsButton icon tip={label} keys={["T"]} tipBelow={tipBelow} onClick={() => setTheme(next[theme])}>
      <Icon />
    </PsButton>
  )
}

export function cycleTheme(theme: PsTheme): PsTheme {
  return ({ system: "light", light: "dark", dark: "system" } as const)[theme]
}

export function HelpButton({ tipBelow }: { tipBelow?: boolean }) {
  const { help, setHelp } = useChrome()
  return (
    <PsButton icon active={help} tip="Keyboard shortcuts" keys={["?"]} tipBelow={tipBelow} onClick={() => setHelp(!help)}>
      <Keyboard />
    </PsButton>
  )
}

/** Modal sheet listing the shortcuts for the current view. Toggled with "?". */
export function ShortcutsSheet({ items }: { items: Array<[string, string]> }) {
  const { help, setHelp } = useChrome()
  if (!help) return null
  return (
    <div className="ps-sheet" onClick={() => setHelp(false)}>
      <div className="ps ps-glass-strong rounded-2xl p-5 w-[420px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <Keyboard className="size-4" style={{ color: "var(--ps-muted)" }} />
          <span className="font-semibold text-[13px]">Keyboard shortcuts</span>
          <span className="ps-sub ml-auto">press ? to close</span>
        </div>
        <div className="ps-sheet-grid">
          {items.map(([what, keys]) => (
            <div key={what} className="contents">
              <span>{what}</span>
              <span className="flex gap-1 justify-end">
                {keys.split(" ").map((k, i) => (
                  <Kbd key={i}>{k}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The honesty label that sits next to the chrome, plus the hide-UI hint. */
export function MockNotice({ className }: { className?: string }) {
  return (
    <div className={cn("ps flex items-center gap-3 select-none", className)} style={{ color: "var(--ps-muted)", fontSize: 11 }}>
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-1.5 rounded-full" style={{ background: "var(--ps-pin)" }} />
        Mock only — not a real product
      </span>
      <span className="flex items-center gap-1.5" style={{ color: "var(--ps-faint)" }}>
        <Keys keys={HIDE_KEY_LABEL} />
        <span>or</span>
        <Keys keys={HIDE_KEY_ALT} />
        <span>hides UI</span>
      </span>
    </div>
  )
}

/** Always-visible, low-key toggle for the chrome — the on-screen fallback for the shortcut. */
export function EyeToggle() {
  const { hidden, setHidden } = useChrome()
  return (
    <button
      className="ps-eye"
      data-hidden={hidden ? "true" : undefined}
      title={`${hidden ? "Show" : "Hide"} Protopact UI`}
      onClick={() => setHidden(!hidden)}
    >
      {hidden ? <EyeOff /> : <Eye />}
    </button>
  )
}

/** Placeholder block used while lazy pages load — no host-kit dependency. */
export function PsSkeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("ps-skeleton", className)} style={style} />
}

export interface PsOption {
  value: string
  label: ReactNode
}

/**
 * A small dropdown for the chrome. Opens upward by default (the bar sits at
 * the bottom of the screen); closes on outside click or Escape.
 */
export function PsSelect({
  value,
  options,
  onChange,
  prefix,
  placeholder,
  title,
  align = "start",
  direction = "up",
}: {
  value: string
  options: PsOption[]
  onChange: (v: string) => void
  prefix?: ReactNode
  placeholder?: ReactNode
  title?: string
  align?: "start" | "end"
  direction?: "up" | "down"
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="ps-select"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {prefix && <span className="ps-chip-k">{prefix}</span>}
        <span>{current?.label ?? placeholder}</span>
        <ChevronDown className="ps-select-chevron" />
      </button>
      {open && (
        <div
          role="listbox"
          className={cn("ps-menu absolute z-50 min-w-40", align === "end" ? "right-0" : "left-0")}
          style={direction === "up" ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="ps-menu-item"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              <span className="flex-1 text-left">{o.label}</span>
              {o.value === value && <Check className="size-3.5" style={{ color: "var(--ps-accent)" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
