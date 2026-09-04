// Reads Orbit's "dimensions" (role, state, lifecycle, step, density, locale,
// overlay) from the URL's search params, and navigates between routes the
// same way the old viewer's `nav(pageId, dims)` did — except now it's a real
// route push instead of viewer-glue page swap.
import { useNavigate, useSearchParams } from "react-router-dom"

/** Every dimension id Orbit's pages declare (SPEC: stavy.json `dimensions[].id`). */
const DIMENSION_IDS = ["role", "state", "lifecycle", "step", "density", "locale", "overlay"] as const
// `expense` (which record the detail page shows) travels as the path segment of /expenses/:id, not a search param.

/** page id -> route path. `expense-detail` carries the row id as a path param. */
const ROUTES: Record<string, string> = {
  dashboard: "/",
  expenses: "/expenses",
  "expense-detail": "/expenses/:id",
  "submit-expense": "/submit",
  "approval-actions": "/components/approval-actions",
  "flow-progress": "/components/flow-progress",
  "work-queue": "/components/work-queue",
}

/** Row id expense-detail falls back to when a caller doesn't pass one. */
const DEFAULT_EXPENSE_ID = "exp-2101"

/**
 * Merge `useSearchParams()` over `defaults` for exactly the known dimension
 * ids, so a page always sees its per-route defaults with any URL override
 * (including workspace-scoped dims like `locale` the route didn't declare).
 */
export function useDims(defaults: Record<string, string>): Record<string, string> {
  const [searchParams] = useSearchParams()
  const dims: Record<string, string> = { ...defaults }
  for (const id of DIMENSION_IDS) {
    const value = searchParams.get(id)
    // An empty `?locale=` (e.g. an unfilled `{dim}` placeholder in a url
    // template whose page doesn't default that dimension) is treated as
    // absent, not as an explicit override — templates fall back on `??`,
    // which only catches null/undefined.
    if (value) dims[id] = value
  }
  return dims
}

/** Build the path + query string for `pageId`, given explicit dim/id overrides. */
export function pathFor(pageId: string, overrides: Record<string, string> = {}): string {
  const { id, expense, ...dims } = overrides
  const base = pageId === "expense-detail" ? `/expenses/${expense ?? id ?? DEFAULT_EXPENSE_ID}` : (ROUTES[pageId] ?? "/")
  const query = new URLSearchParams(dims).toString()
  return query ? `${base}?${query}` : base
}

/**
 * Navigate to `pageId`'s route with a query string containing only the
 * explicit `overrides` plus, always, the current `locale` if the URL has one
 * (locale is workspace-scoped: it should survive every navigation unless the
 * caller explicitly overrides it).
 */
export function useAppNav() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  return (pageId: string, overrides: Record<string, string> = {}) => {
    const merged = { ...overrides }
    if (merged.locale == null) {
      const currentLocale = searchParams.get("locale")
      if (currentLocale != null) merged.locale = currentLocale
    }
    navigate(pathFor(pageId, merged))
  }
}
