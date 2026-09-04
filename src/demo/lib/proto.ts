/**
 * Stamp an element as a Stavy semantic target.
 *
 * `id` is the stable handle used by scenario steps, annotations, and the
 * inspector. `meta` is free-form and shows up in dev-mode inspection.
 */
export function proto(id: string, meta?: Record<string, unknown>) {
  const attrs: Record<string, string> = { "data-proto": id }
  if (meta) attrs["data-proto-meta"] = JSON.stringify(meta)
  return attrs
}
