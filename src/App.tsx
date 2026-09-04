import { BrowserRouter, Route, Routes } from "react-router-dom"
import { DashboardRoute, ExpensesRoute, ExpenseDetailRoute, SubmitExpenseRoute } from "./demo/app/routes"
import ApprovalActionsComponent from "./demo/components/approval-actions"
import FlowProgressComponent from "./demo/components/flow-progress"
import WorkQueueComponent from "./demo/components/work-queue"

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Routes>
        <Route path="/" element={<DashboardRoute />} />
        <Route path="/expenses" element={<ExpensesRoute />} />
        <Route path="/expenses/:id" element={<ExpenseDetailRoute />} />
        <Route path="/submit" element={<SubmitExpenseRoute />} />
        <Route path="/components/approval-actions" element={<ApprovalActionsComponent />} />
        <Route path="/components/flow-progress" element={<FlowProgressComponent />} />
        <Route path="/components/work-queue" element={<WorkQueueComponent />} />
        <Route path="*" element={<div className="p-8 text-sm text-muted-foreground">Not found.</div>} />
      </Routes>
    </BrowserRouter>
  )
}
