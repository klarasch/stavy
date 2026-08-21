import { Plus, Inbox } from "lucide-react"
import { Button } from "@/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/ui/card"
import { Skeleton } from "@/ui/skeleton"
import { Separator } from "@/ui/separator"
import { proto } from "@/protoscope/proto"
import type { PageProps } from "@/protoscope/types"
import { AppFrame } from "./AppFrame"
import { WorkQueue } from "../organisms/WorkQueue"
import { dashboardFixture } from "../fixtures"

export function DashboardTemplate({ dims, nav }: PageProps) {
  const role = dims.role ?? "employee"
  const state = dims.state ?? "loaded"
  const fx = dashboardFixture(role)

  return (
    <AppFrame dims={dims} nav={nav} active="dashboard">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Good morning, Klara</h1>
          <p className="text-sm text-muted-foreground">
            {role === "employee"
              ? "Here's where your expenses stand."
              : role === "manager"
                ? "Your team's spend at a glance."
                : "Reimbursement pipeline overview."}
          </p>
        </div>
        {role === "employee" && (
          <Button
            onClick={() => nav("submit-expense")}
            {...proto("NewExpenseButton", { component: "Button", variant: "default", opens: "submit-expense" })}
          >
            <Plus /> New expense
          </Button>
        )}
      </div>

      {state === "loading" ? (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : state === "empty" ? (
        <Card className="mb-6">
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <Inbox className="size-10 text-muted-foreground/50" />
            <div className="font-medium">Nothing here yet</div>
            <p className="text-sm text-muted-foreground max-w-sm">
              Submit your first expense and it will show up here along with its approval status.
            </p>
            <Button
              className="mt-2"
              onClick={() => nav("submit-expense")}
              {...proto("NewExpenseButton", { component: "Button", context: "empty state CTA" })}
            >
              <Plus /> Submit your first expense
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4 mb-6" {...proto("StatCards", { component: "Card ×4", data: "dashboardFixture(role).stats" })}>
            {fx.stats.map((s) => (
              <Card key={s.label} className="gap-2 py-5">
                <CardHeader className="pb-0">
                  <CardDescription>{s.label}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">{s.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s.delta}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-5 gap-4">
            <WorkQueue
              className="col-span-3"
              title={fx.queueTitle}
              subtitle={role === "employee" ? "Latest first" : "Oldest first — keep the queue moving"}
              items={fx.queue}
              onOpen={(e) => nav("expense-detail", { role, lifecycle: e.status })}
              onViewAll={() => nav("expenses", { role })}
            />

            <Card className="col-span-2" {...proto("ActivityFeed", { component: "Card + list", data: "static fixture" })}>
              <CardHeader>
                <CardTitle>Activity</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col">
                {fx.activity.map((a, i) => (
                  <div key={i}>
                    {i > 0 && <Separator className="my-3" />}
                    <div className="text-sm leading-snug">{a.text}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{a.when}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </AppFrame>
  )
}
