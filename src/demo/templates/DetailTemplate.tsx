import { ArrowLeft, Receipt } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card"
import { Separator } from "@/ui/separator"
import { proto } from "@/demo/lib/proto"
import { cn } from "@/lib/utils"
import type { PageProps } from "@/demo/app/types"
import { AppFrame, StatusBadge, money } from "./AppFrame"
import { expenseDetailFixture, timelineFor } from "../fixtures"
import { ApprovalActions } from "../organisms/ApprovalActions"
import { ConfirmModal } from "../organisms/ConfirmModal"
import { makeT } from "../strings"

export function DetailTemplate({ dims, nav }: PageProps) {
  const role = dims.role ?? "employee"
  const lifecycle = dims.lifecycle ?? "submitted"
  const density = dims.density ?? "comfortable"
  const locale = dims.locale ?? "en-US"
  const overlay = dims.overlay ?? "none"
  const expense = dims.expense ?? "exp-2101"
  const t = makeT(locale)
  const e = expenseDetailFixture(lifecycle, expense)
  const events = timelineFor(lifecycle)
  const goTo = (patch: Record<string, string>) =>
    nav("expense-detail", { expense, role, lifecycle, density, locale, overlay: "none", ...patch })
  // Rejecting is destructive, so it walks to the overlay dimension first; the
  // modal's confirm advances the lifecycle. Both are nav() — every state on canvas.
  const setLifecycle = (next: string) =>
    next === "rejected" ? goTo({ overlay: "reject-confirm" }) : goTo({ lifecycle: next })

  return (
    <AppFrame dims={dims} nav={nav} active="expenses">
      <div
        className={cn(
          density === "compact" && "text-[13px] [&_[data-slot=card]]:py-4 [&_[data-slot=card]]:gap-3 [&_h1]:text-xl"
        )}
        {...proto("DetailLayout", { component: "DetailTemplate", density, locale })}
      >
      <button
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 cursor-pointer"
        onClick={() => nav("expenses", { role })}
      >
        <ArrowLeft className="size-4" /> {t("detail.back")}
      </button>

      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{e.merchant}</h1>
        <StatusBadge status={lifecycle} locale={locale} />
        <span className="ml-auto text-2xl font-semibold tabular-nums">{money(e.amount, locale)}</span>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <div className="col-span-3 flex flex-col gap-4">
          <Card {...proto("ExpenseMeta", { component: "Card", data: "expenseDetailFixture(lifecycle)" })}>
            <CardHeader>
              <CardTitle>{t("detail.details")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                {[
                  [t("detail.field.submittedBy"), "Morgan Lee"],
                  [t("detail.field.date"), `${e.date}, 2026`],
                  [t("detail.field.category"), e.category],
                  [t("detail.field.costCenter"), e.costCenter],
                  [t("detail.field.id"), e.id.toUpperCase()],
                  [t("detail.field.note"), e.note ?? "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-medium mt-0.5">{v}</dd>
                  </div>
                ))}
              </dl>
              <Separator className="my-4" />
              <div className="flex items-center gap-3 text-sm" {...proto("ReceiptPreview", { component: "placeholder", mock: "no real file" })}>
                <div className="size-14 rounded-md border bg-muted flex items-center justify-center">
                  <Receipt className="size-6 text-muted-foreground" />
                </div>
                <div>
                  <div className="font-medium">receipt_dataconf.pdf</div>
                  <div className="text-muted-foreground text-xs">Uploaded Aug 18 · 214 KB</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card {...proto("LifecycleTimeline", { component: "Card + custom timeline", drivenBy: "lifecycle dimension" })}>
            <CardHeader>
              <CardTitle>{t("detail.timeline")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-0 text-sm">
              {events.map((ev, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={cn(
                        "size-2.5 rounded-full mt-1",
                        ev.tone === "positive" && "bg-emerald-500",
                        ev.tone === "negative" && "bg-red-500",
                        ev.tone === "neutral" && "bg-muted-foreground/40"
                      )}
                    />
                    {i < events.length - 1 && <div className="w-px flex-1 bg-border my-1" />}
                  </div>
                  <div className={cn("pb-4", i === events.length - 1 && "pb-0")}>
                    <div className="font-medium">{ev.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {ev.who} · {ev.when}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="col-span-2">
          <ApprovalActions role={role} lifecycle={lifecycle} onAdvance={setLifecycle} locale={locale} />
        </div>
      </div>
      </div>
      {overlay === "reject-confirm" && (
        <ConfirmModal
          title={t("actions.rejectConfirm.title")}
          body={t("actions.rejectConfirm.body")}
          confirmLabel={t("actions.rejectConfirm.confirm")}
          cancelLabel={t("actions.rejectConfirm.cancel")}
          onConfirm={() => goTo({ lifecycle: "rejected" })}
          onCancel={() => goTo({})}
        />
      )}
    </AppFrame>
  )
}
