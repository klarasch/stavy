import { ArrowLeft, ArrowRight, CloudUpload, PartyPopper } from "lucide-react"
import { Button } from "@/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/ui/card"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Textarea } from "@/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import { proto } from "@/demo/lib/proto"
import type { PageProps } from "@/demo/app/types"
import { AppFrame } from "./AppFrame"
import { FlowProgress } from "../organisms/FlowProgress"
import { makeT } from "../strings"

export function FormFlowTemplate({ dims, nav }: PageProps) {
  const step = dims.step ?? "details"
  const t = makeT(dims.locale)
  const go = (s: string) => nav("submit-expense", { step: s })
  const categories = ["travel", "meals", "lodging", "software", "events", "supplies"] as const

  return (
    <AppFrame dims={dims} nav={nav} active="submit-expense">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">{t("flow.title")}</h1>
        <p className="text-sm text-muted-foreground mb-6">{t("flow.sub")}</p>

        <div className="mb-6">
          <FlowProgress step={step} locale={dims.locale} />
        </div>

        {step === "details" && (
          <Card>
            <CardHeader>
              <CardTitle>{t("flow.details.title")}</CardTitle>
              <CardDescription>{t("flow.details.sub")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="merchant">{t("flow.field.merchant")}</Label>
                  <Input id="merchant" placeholder={t("flow.field.merchantPlaceholder")} defaultValue="DataConf 2026" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="amount">{t("flow.field.amount")}</Label>
                  <Input id="amount" placeholder="0.00" defaultValue="890.00" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="date">{t("flow.field.date")}</Label>
                  <Input id="date" defaultValue="Aug 18, 2026" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{t("flow.field.category")}</Label>
                  <Select defaultValue="events">
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c}>
                          {t(`category.${c}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="note">{t("flow.field.note")}</Label>
                <Textarea id="note" placeholder={t("flow.field.notePlaceholder")} defaultValue="Conference ticket, early-bird rate" />
              </div>
              <div className="flex justify-end pt-2">
                <Button onClick={() => go("receipt")} {...proto("ContinueButton", { component: "Button", advancesTo: "receipt" })}>
                  {t("flow.continue")} <ArrowRight />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "receipt" && (
          <Card>
            <CardHeader>
              <CardTitle>{t("flow.receipt.title")}</CardTitle>
              <CardDescription>{t("flow.receipt.sub")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <button
                className="border-2 border-dashed rounded-xl py-12 flex flex-col items-center gap-2 text-muted-foreground hover:border-violet-300 hover:text-foreground transition-colors cursor-pointer"
                {...proto("ReceiptDropzone", { component: "custom dropzone", mock: "upload is faked" })}
              >
                <CloudUpload className="size-8" />
                <span className="text-sm font-medium">{t("flow.receipt.drop")}</span>
                <span className="text-xs">{t("flow.receipt.hint")}</span>
              </button>
              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={() => go("details")}>
                  <ArrowLeft /> {t("flow.back")}
                </Button>
                <Button onClick={() => go("review")} {...proto("ContinueButton", { component: "Button", advancesTo: "review" })}>
                  {t("flow.continue")} <ArrowRight />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "review" && (
          <Card>
            <CardHeader>
              <CardTitle>{t("flow.review.title")}</CardTitle>
              <CardDescription>{t("flow.review.sub")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="text-sm flex flex-col divide-y">
                {[
                  [t("flow.field.merchant"), "DataConf 2026"],
                  [t("flow.field.amount"), "$890.00"],
                  [t("flow.field.date"), "Aug 18, 2026"],
                  [t("flow.field.category"), t("category.events")],
                  [t("flow.review.receipt"), "receipt_dataconf.pdf"],
                  [t("flow.review.approver"), "M. Novak (your manager)"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-2.5">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={() => go("receipt")}>
                  <ArrowLeft /> {t("flow.back")}
                </Button>
                <Button onClick={() => go("done")} {...proto("SubmitButton", { component: "Button", advancesTo: "done", sideEffect: "lifecycle → submitted" })}>
                  {t("flow.submit")}
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
              <div className="text-lg font-semibold">{t("flow.done.title")}</div>
              <p className="text-sm text-muted-foreground max-w-sm">{t("flow.done.body")}</p>
              <div className="flex gap-2 mt-3">
                <Button
                  onClick={() => nav("expenses", { role: "employee" })}
                  {...proto("ViewExpensesButton", { component: "Button", opens: "expenses" })}
                >
                  {t("flow.done.view")}
                </Button>
                <Button variant="outline" onClick={() => go("details")}>
                  {t("flow.done.again")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppFrame>
  )
}
