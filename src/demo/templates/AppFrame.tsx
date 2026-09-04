import { Zap } from "lucide-react"
import { Avatar, AvatarFallback } from "@/ui/avatar"
import { proto } from "@/demo/lib/proto"
import { cn } from "@/lib/utils"
import type { PageProps } from "@/demo/app/types"
import { makeT } from "../strings"

const roleInitials: Record<string, string> = { employee: "KS", manager: "MN", finance: "FT" }

export function AppFrame({
  dims,
  nav,
  active,
  children,
}: PageProps & { active: string; children: React.ReactNode }) {
  const role = dims.role ?? "employee"
  const t = makeT(dims.locale)
  const links = [
    { id: "dashboard", label: t("nav.dashboard") },
    { id: "expenses", label: t("nav.expenses") },
    { id: "submit-expense", label: t("nav.new") },
  ]
  return (
    <div className="min-h-full bg-muted/40 flex flex-col">
      <header
        className="h-14 shrink-0 border-b bg-background flex items-center gap-8 px-6"
        {...proto("AppTopBar", { component: "AppFrame header", roleAware: true })}
      >
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <Zap className="size-5 text-violet-600 fill-violet-600/20" />
          Orbit
        </div>
        <nav className="flex items-center gap-1 text-sm">
          {links.map((l) => (
            <button
              key={l.id}
              onClick={() => nav(l.id, { role })}
              className={cn(
                "px-3 py-1.5 rounded-md transition-colors cursor-pointer",
                active === l.id
                  ? "bg-accent font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
              )}
            >
              {l.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground capitalize">{role}</span>
          <Avatar>
            <AvatarFallback className="bg-violet-100 text-violet-700">
              {roleInitials[role] ?? "??"}
            </AvatarFallback>
          </Avatar>
        </div>
      </header>
      <main className="flex-1 p-8 max-w-6xl w-full mx-auto">{children}</main>
    </div>
  )
}

export const statusStyles: Record<string, string> = {
  draft: "bg-secondary text-secondary-foreground",
  submitted: "bg-blue-100 text-blue-800",
  "in-review": "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  reimbursed: "bg-violet-100 text-violet-800",
}

export function StatusBadge({ status, locale }: { status: string; locale?: string }) {
  const t = makeT(locale)
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize",
        statusStyles[status] ?? "bg-secondary"
      )}
      data-slot="badge"
    >
      {t(`status.${status}` as Parameters<typeof t>[0])}
    </span>
  )
}

export function money(n: number, locale = "en-US") {
  return n.toLocaleString(locale, { style: "currency", currency: locale.startsWith("de") ? "EUR" : "USD" })
}
