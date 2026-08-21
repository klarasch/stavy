import { Check, X, MessageSquareWarning, Banknote, Pencil, Send } from "lucide-react"
import { Button } from "@/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card"
import { proto } from "@/protopact/proto"
import { makeT } from "../strings"

/**
 * Organism: the role × lifecycle action matrix for an expense.
 * Used by the detail page and registered on its own as component "approval-actions".
 */
export function ApprovalActions({
  role,
  lifecycle,
  onAdvance,
  locale,
}: {
  role: string
  lifecycle: string
  onAdvance: (next: string) => void
  locale?: string
}) {
  const t = makeT(locale)
  const employeeDraft = role === "employee" && lifecycle === "draft"
  const managerDecides = role === "manager" && ["submitted", "in-review"].includes(lifecycle)
  const financeReimburses = role === "finance" && lifecycle === "approved"
  return (
    <Card
      {...proto("ApprovalActions", {
        component: "ApprovalActions (organism)",
        organism: "approval-actions",
        matrix: "role × lifecycle",
        note: "buttons advance the lifecycle dimension",
      })}
    >
      <CardHeader>
        <CardTitle>{t("actions.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {employeeDraft && (
          <>
            <Button onClick={() => onAdvance("submitted")} {...proto("SubmitButton", { component: "Button", advancesTo: "submitted" })}>
              <Send /> {t("actions.submit")}
            </Button>
            <Button variant="outline">
              <Pencil /> {t("actions.edit")}
            </Button>
          </>
        )}
        {managerDecides && (
          <>
            <Button onClick={() => onAdvance("approved")} {...proto("ApproveButton", { component: "Button", advancesTo: "approved" })}>
              <Check /> {t("actions.approve")}
            </Button>
            <Button variant="outline" onClick={() => onAdvance("rejected")} {...proto("RejectButton", { component: "Button", advancesTo: "rejected" })}>
              <X /> {t("actions.reject")}
            </Button>
            {lifecycle === "submitted" && (
              <Button variant="ghost" onClick={() => onAdvance("in-review")} {...proto("RequestChangesButton", { component: "Button", advancesTo: "in-review" })}>
                <MessageSquareWarning /> {t("actions.requestChanges")}
              </Button>
            )}
          </>
        )}
        {financeReimburses && (
          <Button onClick={() => onAdvance("reimbursed")} {...proto("ReimburseButton", { component: "Button", advancesTo: "reimbursed" })}>
            <Banknote /> {t("actions.reimburse")}
          </Button>
        )}
        {!employeeDraft && !managerDecides && !financeReimburses && (
          <p className="text-sm text-muted-foreground">
            {t("actions.none", { role, lifecycle: t(`status.${lifecycle}` as Parameters<typeof t>[0]).toLowerCase() })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
