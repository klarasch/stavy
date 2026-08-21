import { ArrowLeft, ArrowRight, CloudUpload, PartyPopper } from "lucide-react"
import { Button } from "@/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/ui/card"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Textarea } from "@/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import { proto } from "@/protoscope/proto"
import type { PageProps } from "@/protoscope/types"
import { AppFrame } from "./AppFrame"
import { FlowProgress } from "../organisms/FlowProgress"

export function FormFlowTemplate({ dims, nav }: PageProps) {
  const step = dims.step ?? "details"
  const go = (s: string) => nav("submit-expense", { step: s })

  return (
    <AppFrame dims={dims} nav={nav} active="submit-expense">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">New expense</h1>
        <p className="text-sm text-muted-foreground mb-6">Takes about a minute. Drafts save automatically.</p>

        <div className="mb-6">
          <FlowProgress step={step} />
        </div>

        {step === "details" && (
          <Card>
            <CardHeader>
              <CardTitle>Expense details</CardTitle>
              <CardDescription>What did you pay for?</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="merchant">Merchant</Label>
                  <Input id="merchant" placeholder="e.g. DataConf 2026" defaultValue="DataConf 2026" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="amount">Amount</Label>
                  <Input id="amount" placeholder="0.00" defaultValue="890.00" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="date">Date</Label>
                  <Input id="date" defaultValue="Aug 18, 2026" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Category</Label>
                  <Select defaultValue="events">
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="travel">Travel</SelectItem>
                      <SelectItem value="meals">Meals</SelectItem>
                      <SelectItem value="lodging">Lodging</SelectItem>
                      <SelectItem value="software">Software</SelectItem>
                      <SelectItem value="events">Events</SelectItem>
                      <SelectItem value="supplies">Supplies</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="note">Note (optional)</Label>
                <Textarea id="note" placeholder="Anything the approver should know" defaultValue="Conference ticket, early-bird rate" />
              </div>
              <div className="flex justify-end pt-2">
                <Button onClick={() => go("receipt")} {...proto("ContinueButton", { component: "Button", advancesTo: "receipt" })}>
                  Continue <ArrowRight />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "receipt" && (
          <Card>
            <CardHeader>
              <CardTitle>Attach a receipt</CardTitle>
              <CardDescription>Required for anything over $25.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <button
                className="border-2 border-dashed rounded-xl py-12 flex flex-col items-center gap-2 text-muted-foreground hover:border-violet-300 hover:text-foreground transition-colors cursor-pointer"
                {...proto("ReceiptDropzone", { component: "custom dropzone", mock: "upload is faked" })}
              >
                <CloudUpload className="size-8" />
                <span className="text-sm font-medium">Drop a file or click to browse</span>
                <span className="text-xs">PDF, PNG or JPG · mocked in this prototype</span>
              </button>
              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={() => go("details")}>
                  <ArrowLeft /> Back
                </Button>
                <Button onClick={() => go("review")} {...proto("ContinueButton", { component: "Button", advancesTo: "review" })}>
                  Continue <ArrowRight />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "review" && (
          <Card>
            <CardHeader>
              <CardTitle>Review</CardTitle>
              <CardDescription>Check everything before submitting.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="text-sm flex flex-col divide-y">
                {[
                  ["Merchant", "DataConf 2026"],
                  ["Amount", "$890.00"],
                  ["Date", "Aug 18, 2026"],
                  ["Category", "Events"],
                  ["Receipt", "receipt_dataconf.pdf"],
                  ["Approver", "M. Novak (your manager)"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-2.5">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={() => go("receipt")}>
                  <ArrowLeft /> Back
                </Button>
                <Button onClick={() => go("done")} {...proto("SubmitButton", { component: "Button", advancesTo: "done", sideEffect: "lifecycle → submitted" })}>
                  Submit expense
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "done" && (
          <Card>
            <CardContent className="py-12 flex flex-col items-center text-center gap-3">
              <div className="size-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <PartyPopper className="size-6 text-emerald-600" />
              </div>
              <div className="text-lg font-semibold">Expense submitted</div>
              <p className="text-sm text-muted-foreground max-w-sm">
                DataConf 2026 · $890.00 is on its way to M. Novak for approval. We'll nudge you when it moves.
              </p>
              <div className="flex gap-2 mt-3">
                <Button
                  onClick={() => nav("expenses", { role: "employee" })}
                  {...proto("ViewExpensesButton", { component: "Button", opens: "expenses" })}
                >
                  View my expenses
                </Button>
                <Button variant="outline" onClick={() => go("details")}>
                  Submit another
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppFrame>
  )
}
