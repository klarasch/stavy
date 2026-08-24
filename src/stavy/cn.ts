/** Minimal clsx-style class join. The viewer's own classes never conflict, so no tailwind-merge. */
export type ClassValue = string | number | null | false | undefined | ClassValue[]
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = []
  const walk = (v: ClassValue) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (typeof v === "string" || typeof v === "number") out.push(String(v))
  }
  inputs.forEach(walk)
  return out.join(" ")
}
