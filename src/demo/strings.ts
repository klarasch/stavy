// Copy catalog: every user-visible string in the prototype lives in strings.json,
// keyed and per locale. Templates never inline copy. This is what designers edit,
// what legal reviews (`npm run strings` → docs/strings.md), and what the `locale`
// dimension switches.
import catalog from "./strings.json"

type Locale = keyof typeof catalog
type Key = keyof (typeof catalog)["en-US"]

export function makeT(locale: string | undefined) {
  const loc = (locale && locale in catalog ? locale : "en-US") as Locale
  return (key: Key, vars?: Record<string, string | number>): string => {
    const raw = (catalog[loc] as Record<string, string>)[key] ?? catalog["en-US"][key] ?? key
    return vars ? raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : raw
  }
}
export type T = ReturnType<typeof makeT>
