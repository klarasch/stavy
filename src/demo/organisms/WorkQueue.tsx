import { ArrowRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/ui/card"
import { Skeleton } from "@/ui/skeleton"
import { proto } from "@/stavy/proto"
import { StatusBadge, money } from "../templates/AppFrame"
import type { Expense } from "../fixtures"
import { makeT } from "../strings"

/** Organism: the role-specific work queue card on the dashboard. */
export function WorkQueue({
  title,
  subtitle,
  items,
  state = "loaded",
  onOpen,
  onViewAll,
  className,
  locale,
}: {
  title: string
  subtitle?: string
  items: Expense[]
  state?: string
  onOpen?: (e: Expense) => void
  onViewAll?: () => void
  className?: string
  locale?: string
}) {
  const t = makeT(locale)
  return (
    <Card
      className={className}
      {...proto("PendingApprovalsCard", { component: "WorkQueue (organism)", organism: "work-queue", roleAware: "queue contents depend on role" })}
    >
      <CardHeader className="flex flex-row items-start justify-between">
        <div className="flex flex-col gap-1.5">
          <CardTitle>{title}</CardTitle>
          {subtitle && <CardDescription>{subtitle}</CardDescription>}
        </div>
        {onViewAll && (
          <button
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
            onClick={onViewAll}
            {...proto("ViewQueueLink", { component: "link", opens: "expenses" })}
          >
            {t("queue.viewAll")} <ArrowRight className="size-3.5" />
          </button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {state === "loading" &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 my-0.5" />)}
        {state === "empty" && <p className="text-sm text-muted-foreground py-4 text-center">{t("queue.empty")}</p>}
        {state === "loaded" &&
          items.map((e) => (
            <button
              key={e.id}
              className="flex items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent cursor-pointer"
              onClick={() => onOpen?.(e)}
            >
              <span className="font-medium flex-1 truncate">{e.merchant}</span>
              <span className="text-muted-foreground w-24 truncate">{e.submitter}</span>
              <span className="w-20 text-right tabular-nums">{money(e.amount)}</span>
              <StatusBadge status={e.status} locale={locale} />
            </button>
          ))}
      </CardContent>
    </Card>
  )
}
