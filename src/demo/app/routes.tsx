// Route elements for Orbit's four full-page templates. Each one reads its
// dims from the URL (per-route defaults matching stavy.json `pages[].defaults`)
// and hands the templates the same { dims, nav } shape they always took.
import { DashboardTemplate } from "../templates/DashboardTemplate"
import { ListTemplate } from "../templates/ListTemplate"
import { DetailTemplate } from "../templates/DetailTemplate"
import { FormFlowTemplate } from "../templates/FormFlowTemplate"
import { useParams } from "react-router-dom"
import { useAppNav, useDims } from "./dims"

const DASHBOARD_DEFAULTS = { role: "employee", state: "loaded" }
const EXPENSES_DEFAULTS = { role: "employee", state: "loaded" }
const EXPENSE_DETAIL_DEFAULTS = {
  role: "employee",
  lifecycle: "submitted",
  density: "comfortable",
  overlay: "none",
  locale: "en-US",
}
const SUBMIT_EXPENSE_DEFAULTS = { step: "details" }

export function DashboardRoute() {
  const dims = useDims(DASHBOARD_DEFAULTS)
  const nav = useAppNav()
  return <DashboardTemplate dims={dims} nav={nav} />
}

export function ExpensesRoute() {
  const dims = useDims(EXPENSES_DEFAULTS)
  const nav = useAppNav()
  return <ListTemplate dims={dims} nav={nav} />
}

export function ExpenseDetailRoute() {
  const { id = "exp-2101" } = useParams()
  // The record is a path segment: /expenses/:id — a dimension all the same.
  const dims = { ...useDims(EXPENSE_DETAIL_DEFAULTS), expense: id }
  const nav = useAppNav()
  return <DetailTemplate dims={dims} nav={nav} />
}

export function SubmitExpenseRoute() {
  const dims = useDims(SUBMIT_EXPENSE_DEFAULTS)
  const nav = useAppNav()
  return <FormFlowTemplate dims={dims} nav={nav} />
}
