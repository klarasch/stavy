import { useState } from "react"
import { patchManifest, useDev, type ManifestPath } from "./dev"
import { cn } from "./cn"

/**
 * A piece of manifest text (a screen's title, a state's label or note) that
 * the dev server lets you rewrite: double-click, type, Enter to save, Esc to
 * cancel. Without the dev endpoint it is just its text. The edit goes through
 * PATCH /__stavy/manifest, so only that one field of stavy.json changes.
 */
export function EditableText({
  path,
  value,
  placeholder,
  className,
  children,
  multiline = false,
}: {
  path?: ManifestPath
  value: string | undefined
  /** Shown (dimmed, on hover) when the field is empty and editable */
  placeholder?: string
  className?: string
  children?: React.ReactNode
  multiline?: boolean
}) {
  const writable = !!useDev()?.writable && !!path
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  if (!writable) return value ? <span className={className}>{children ?? value}</span> : null

  const done = async (save: boolean) => {
    if (busy) return
    const next = text.trim()
    if (!save || next === (value ?? "")) return setEditing(false)
    setBusy(true)
    try {
      await patchManifest(path!, next)
    } catch (e) {
      alert(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
      setEditing(false)
    }
  }

  if (editing) {
    const common = {
      autoFocus: true,
      className: cn("ps-inline-input", className),
      value: text,
      "data-ps-ui": true,
      onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setText(e.target.value),
      onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
      onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
      onBlur: () => void done(true),
      onKeyDown: (e: React.KeyboardEvent) => {
        e.stopPropagation()
        if (e.key === "Escape") void done(false)
        else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          void done(true)
        }
      },
    }
    return multiline ? <textarea rows={2} {...common} /> : <input {...common} />
  }

  return (
    <span
      className={cn(className, "ps-editable", !value && "is-empty")}
      title="Double-click to edit"
      data-editable={path!.join("/")}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setText(value ?? "")
        setEditing(true)
      }}
    >
      {value ? (children ?? value) : placeholder}
    </span>
  )
}
