import { Check, X, MessageSquareWarning, Banknote, Pencil, Send } from "lucide-react"
import { Button } from "@/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card"
import { proto } from "@/protoscope/proto"

/**
 * Organism: the role × lifecycle action matrix for an expense.
 * Used by the detail page and registered on its own as component "approval-actions".
 */
export function ApprovalActions({
  role,
  lifecycle,
  onAdvance,
}: {
  role: string
  lifecycle: string
  onAdvance: (next: string) => void
}) {
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
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {employeeDraft && (
          <>
            <Button onClick={() => onAdvance("submitted")} {...proto("SubmitButton", { component: "Button", advancesTo: "submitted" })}>
              <Send /> Submit for approval
            </Button>
            <Button variant="outline">
              <Pencil /> Edit draft
            </Button>
          </>
        )}
        {managerDecides && (
          <>
            <Button onClick={() => onAdvance("approved")} {...proto("ApproveButton", { component: "Button", advancesTo: "approved" })}>
              <Check /> Approve
            </Button>
            <Button variant="outline" onClick={() => onAdvance("rejected")} {...proto("RejectButton", { component: "Button", advancesTo: "rejected" })}>
              <X /> Reject
            </Button>
            {lifecycle === "submitted" && (
              <Button variant="ghost" onClick={() => onAdvance("in-review")} {...proto("RequestChangesButton", { component: "Button", advancesTo: "in-review" })}>
                <MessageSquareWarning /> Request changes
              </Button>
            )}
          </>
        )}
        {financeReimburses && (
          <Button onClick={() => onAdvance("reimbursed")} {...proto("ReimburseButton", { component: "Button", advancesTo: "reimbursed" })}>
            <Banknote /> Mark as reimbursed
          </Button>
        )}
        {!employeeDraft && !managerDecides && !financeReimburses && (
          <p className="text-sm text-muted-foreground">
            No actions for <span className="font-medium capitalize">{role}</span> while this expense is{" "}
            <span className="font-medium">{lifecycle.replace("-", " ")}</span>.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
