import { Search, Inbox, AlertCircle, RotateCw } from "lucide-react"
import { Input } from "@/ui/input"
import { Button } from "@/ui/button"
import { Badge } from "@/ui/badge"
import { Skeleton } from "@/ui/skeleton"
import { Alert, AlertTitle, AlertDescription } from "@/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table"
import { proto } from "@/stavy/proto"
import type { PageProps } from "@/stavy/types"
import { AppFrame, StatusBadge, money } from "./AppFrame"
import { expensesForRole } from "../fixtures"
import { makeT } from "../strings"

export function ListTemplate({ dims, nav }: PageProps) {
  const role = dims.role ?? "employee"
  const state = dims.state ?? "loaded"
  const rows = expensesForRole(role)
  const showSubmitter = role !== "employee"
  const t = makeT(dims.locale)
  const statuses = ["submitted", "in-review", "approved", "rejected", "reimbursed"] as const

  return (
    <AppFrame dims={dims} nav={nav} active="expenses">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("list.title")}</h1>
        {state === "loaded" && <Badge variant="secondary">{rows.length}</Badge>}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input placeholder={t("list.search")} className="pl-8 bg-background" {...proto("SearchInput", { component: "Input", mock: "not wired" })} />
        </div>
        <div {...proto("StatusFilter", { component: "Select", defaultForFinance: "approved" })}>
          <Select defaultValue={role === "finance" ? "approved" : "all"}>
            <SelectTrigger size="sm" className="bg-background w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("list.filter.all")}</SelectItem>
              {statuses.map((st) => (
                <SelectItem key={st} value={st}>
                  {t(`status.${st}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {state === "error" ? (
        <Alert variant="destructive" className="max-w-xl">
          <AlertCircle />
          <AlertTitle>{t("list.error.title")}</AlertTitle>
          <AlertDescription>
            <p>{t("list.error.body")}</p>
            <Button size="sm" variant="outline" className="mt-2" {...proto("RetryButton", { component: "Button" })}>
              <RotateCw /> {t("list.error.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : state === "empty" ? (
        <div className="border rounded-xl bg-background py-16 flex flex-col items-center gap-3 text-center">
          <Inbox className="size-10 text-muted-foreground/50" />
          <div className="font-medium">{t("list.empty.title")}</div>
          <p className="text-sm text-muted-foreground">{t("list.empty.body")}</p>
          <Button size="sm" className="mt-1" onClick={() => nav("submit-expense")}>
            {t("list.empty.cta")}
          </Button>
        </div>
      ) : (
        <div className="border rounded-xl bg-background overflow-hidden" {...proto("ExpenseTable", { component: "Table", rows: rows.length, roleAware: "submitter column hidden for employees" })}>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="pl-4">{t("list.col.merchant")}</TableHead>
                <TableHead>{t("list.col.category")}</TableHead>
                {showSubmitter && <TableHead>{t("list.col.submittedBy")}</TableHead>}
                <TableHead>{t("list.col.date")}</TableHead>
                <TableHead className="text-right">{t("list.col.amount")}</TableHead>
                <TableHead className="pr-4">{t("list.col.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state === "loading"
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: showSubmitter ? 6 : 5 }).map((_, j) => (
                        <TableCell key={j} className={j === 0 ? "pl-4" : ""}>
                          <Skeleton className="h-4 w-full max-w-32" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : rows.map((e) => (
                    <TableRow
                      key={e.id}
                      className="cursor-pointer"
                      onClick={() => nav("expense-detail", { role, lifecycle: e.status })}
                      {...proto(`ExpenseRow:${e.id}`, { component: "TableRow", expense: e.id, opensLifecycle: e.status })}
                    >
                      <TableCell className="pl-4 font-medium">{e.merchant}</TableCell>
                      <TableCell className="text-muted-foreground">{e.category}</TableCell>
                      {showSubmitter && <TableCell className="text-muted-foreground">{e.submitter}</TableCell>}
                      <TableCell className="text-muted-foreground">{e.date}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(e.amount)}</TableCell>
                      <TableCell className="pr-4">
                        <StatusBadge status={e.status} locale={dims.locale} />
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppFrame>
  )
}
