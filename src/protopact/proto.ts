/**
 * Stamp an element as a Protopact semantic target.
 *
 * `id` is the stable handle used by scenario steps, annotations, and the
 * inspector. `meta` is free-form and shows up in dev-mode inspection.
 */
export function proto(id: string, meta?: Record<string, unknown>) {
  const attrs: Record<string, string> = { "data-proto": id }
  if (meta) attrs["data-proto-meta"] = JSON.stringify(meta)
  return attrs
}

/** Find a proto target element inside a container. */
export function findProtoTarget(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-proto="${CSS.escape(id)}"]`)
}
