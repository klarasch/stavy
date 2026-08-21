import { Search, Inbox, AlertCircle, RotateCw } from "lucide-react"
import { Input } from "@/ui/input"
import { Button } from "@/ui/button"
import { Badge } from "@/ui/badge"
import { Skeleton } from "@/ui/skeleton"
import { Alert, AlertTitle, AlertDescription } from "@/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table"
import { proto } from "@/protoscope/proto"
import type { PageProps } from "@/protoscope/types"
import { AppFrame, StatusBadge, money } from "./AppFrame"
import { expensesForRole } from "../fixtures"

export function ListTemplate({ dims, nav }: PageProps) {
  const role = dims.role ?? "employee"
  const state = dims.state ?? "loaded"
  const rows = expensesForRole(role)
  const showSubmitter = role !== "employee"

  return (
    <AppFrame dims={dims} nav={nav} active="expenses">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
        {state === "loaded" && <Badge variant="secondary">{rows.length}</Badge>}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input placeholder="Search merchant…" className="pl-8 bg-background" {...proto("SearchInput", { component: "Input", mock: "not wired" })} />
        </div>
        <div {...proto("StatusFilter", { component: "Select", defaultForFinance: "approved" })}>
          <Select defaultValue={role === "finance" ? "approved" : "all"}>
            <SelectTrigger size="sm" className="bg-background w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="in-review">In review</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="reimbursed">Reimbursed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {state === "error" ? (
        <Alert variant="destructive" className="max-w-xl">
          <AlertCircle />
          <AlertTitle>Couldn't load expenses</AlertTitle>
          <AlertDescription>
            <p>The expenses service returned a 502. Your data is safe — this is just the list view failing.</p>
            <Button size="sm" variant="outline" className="mt-2" {...proto("RetryButton", { component: "Button" })}>
              <RotateCw /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : state === "empty" ? (
        <div className="border rounded-xl bg-background py-16 flex flex-col items-center gap-3 text-center">
          <Inbox className="size-10 text-muted-foreground/50" />
          <div className="font-medium">No expenses yet</div>
          <p className="text-sm text-muted-foreground">When you submit expenses they'll be listed here.</p>
          <Button size="sm" className="mt-1" onClick={() => nav("submit-expense")}>
            New expense
          </Button>
        </div>
      ) : (
        <div className="border rounded-xl bg-background overflow-hidden" {...proto("ExpenseTable", { component: "Table", rows: rows.length, roleAware: "submitter column hidden for employees" })}>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="pl-4">Merchant</TableHead>
                <TableHead>Category</TableHead>
                {showSubmitter && <TableHead>Submitted by</TableHead>}
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="pr-4">Status</TableHead>
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
                        <StatusBadge status={e.status} />
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
