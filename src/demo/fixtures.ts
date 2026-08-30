// Mock data fixtures for the Orbit demo product.
// Fixtures are functions of the dimension assignment, so every variant the
// manifest declares resolves to concrete data.

export type ExpenseStatus = "draft" | "submitted" | "in-review" | "approved" | "rejected" | "reimbursed"

export interface Expense {
  id: string
  merchant: string
  category: string
  date: string
  amount: number
  status: ExpenseStatus
  submitter: string
  costCenter: string
  note?: string
}

export const expenses: Expense[] = [
  { id: "exp-2101", merchant: "DataConf 2026", category: "Events", date: "Aug 18", amount: 890, status: "submitted", submitter: "You", costCenter: "R&D", note: "Conference ticket, early-bird rate" },
  { id: "exp-2102", merchant: "SkyRail", category: "Travel", date: "Aug 15", amount: 132.5, status: "approved", submitter: "You", costCenter: "R&D", note: "Train to the Berlin office" },
  { id: "exp-2103", merchant: "Café Beacon", category: "Meals", date: "Aug 14", amount: 46.2, status: "in-review", submitter: "Alex Rivera", costCenter: "Design", note: "Team lunch, 3 people" },
  { id: "exp-2104", merchant: "Nimbus Cloud", category: "Software", date: "Aug 12", amount: 240, status: "submitted", submitter: "Sam Chen", costCenter: "R&D", note: "Annual plan renewal" },
  { id: "exp-2105", merchant: "Hotel Verde", category: "Lodging", date: "Aug 11", amount: 412, status: "rejected", submitter: "You", costCenter: "R&D", note: "Rate above policy limit" },
  { id: "exp-2106", merchant: "OfficeMart", category: "Supplies", date: "Aug 8", amount: 63.9, status: "reimbursed", submitter: "Jordan Blake", costCenter: "Ops" },
  { id: "exp-2107", merchant: "RideNow", category: "Travel", date: "Aug 6", amount: 28.4, status: "approved", submitter: "Alex Rivera", costCenter: "Design" },
  { id: "exp-2108", merchant: "AirBridge", category: "Travel", date: "Aug 4", amount: 511, status: "reimbursed", submitter: "You", costCenter: "R&D", note: "Flight to the offsite" },
]

export function expensesForRole(role: string): Expense[] {
  if (role === "employee") return expenses.filter((e) => e.submitter === "You")
  if (role === "finance") return expenses.filter((e) => ["approved", "reimbursed"].includes(e.status))
  return expenses
}

export function dashboardFixture(role: string) {
  if (role === "manager") {
    return {
      stats: [
        { label: "Awaiting your review", value: "4", delta: "+2 since yesterday" },
        { label: "Team spend this month", value: "$12,430", delta: "78% of budget" },
        { label: "Approved this month", value: "23", delta: "avg $187" },
        { label: "Avg approval time", value: "1.2d", delta: "target < 2d" },
      ],
      queueTitle: "Awaiting your approval",
      queue: expenses.filter((e) => ["submitted", "in-review"].includes(e.status)),
      activity: [
        { text: "Sam Chen submitted Nimbus Cloud renewal ($240)", when: "2h ago" },
        { text: "You approved SkyRail travel for Morgan ($132.50)", when: "1d ago" },
        { text: "Alex Rivera's team lunch moved to in-review", when: "1d ago" },
        { text: "Policy update: lodging cap raised to $350/night", when: "3d ago" },
      ],
    }
  }
  if (role === "finance") {
    return {
      stats: [
        { label: "Ready to reimburse", value: "7", delta: "$1,834 total" },
        { label: "Reimbursed this month", value: "$18,204", delta: "42 expenses" },
        { label: "Open exceptions", value: "1", delta: "policy flag" },
        { label: "Next payout run", value: "Aug 29", delta: "in 9 days" },
      ],
      queueTitle: "Reimbursement queue",
      queue: expenses.filter((e) => e.status === "approved"),
      activity: [
        { text: "Payout run #88 completed — $6,410 to 12 people", when: "2d ago" },
        { text: "SkyRail travel approved by M. Novak", when: "2d ago" },
        { text: "Exception raised on Hotel Verde ($412)", when: "4d ago" },
      ],
    }
  }
  return {
    stats: [
      { label: "This month", value: "$1,284", delta: "4 expenses" },
      { label: "Pending", value: "2", delta: "$1,130 awaiting" },
      { label: "Reimbursed YTD", value: "$4,913", delta: "18 expenses" },
      { label: "Avg approval time", value: "1.8d", delta: "across your team" },
    ],
    queueTitle: "Your recent expenses",
    queue: expensesForRole("employee").slice(0, 4),
    activity: [
      { text: "DataConf 2026 ticket submitted for approval", when: "2d ago" },
      { text: "SkyRail travel was approved by M. Novak", when: "3d ago" },
      { text: "Hotel Verde was rejected — over policy limit", when: "1w ago" },
      { text: "AirBridge flight reimbursed — $511", when: "2w ago" },
    ],
  }
}

export function expenseDetailFixture(lifecycle: string): Expense {
  const base = expenses.find((e) => e.id === "exp-2101")!
  return { ...base, status: lifecycle as ExpenseStatus }
}

export interface TimelineEvent {
  label: string
  who: string
  when: string
  tone: "neutral" | "positive" | "negative"
}

export function timelineFor(lifecycle: string): TimelineEvent[] {
  const events: TimelineEvent[] = [{ label: "Created as draft", who: "Morgan L.", when: "Aug 17, 09:12", tone: "neutral" }]
  const order = ["draft", "submitted", "in-review", "approved", "rejected", "reimbursed"]
  const idx = order.indexOf(lifecycle)
  if (idx >= 1 && lifecycle !== "draft")
    events.push({ label: "Submitted for approval", who: "Morgan L.", when: "Aug 18, 14:03", tone: "neutral" })
  if (lifecycle === "in-review")
    events.push({ label: "Changes requested — receipt unreadable", who: "M. Novak (manager)", when: "Aug 19, 10:40", tone: "neutral" })
  if (lifecycle === "rejected")
    events.push({ label: "Rejected — outside travel policy", who: "M. Novak (manager)", when: "Aug 19, 10:40", tone: "negative" })
  if (idx >= order.indexOf("approved") && ["approved", "reimbursed"].includes(lifecycle))
    events.push({ label: "Approved", who: "M. Novak (manager)", when: "Aug 19, 11:15", tone: "positive" })
  if (lifecycle === "reimbursed")
    events.push({ label: "Reimbursed in payout run #89", who: "Finance bot", when: "Aug 20, 08:00", tone: "positive" })
  return events
}
