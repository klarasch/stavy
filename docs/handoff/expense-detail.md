# Expense detail

A single expense across its whole lifecycle; actions depend on role × lifecycle. Also varies by density and locale (4 dimensions → the toolbar switches to a panel).

| | |
|---|---|
| id | `expense-detail` |
| template | `detail-page` — `src/demo/templates/DetailTemplate.tsx` |
| UI-kit components | Card, Badge, Button, Separator, Avatar |
| organisms | [Approval actions](./approval-actions.md) |
| fidelity | interactive |
| module | `src/demo/pages/expense-detail.tsx` |

## Dimensions

- **Role** (`role`): **Employee** (default) · Manager · Finance
- **Expense lifecycle** (`lifecycle`): Draft · **Submitted** (default) · In review · Approved · Rejected · Reimbursed
- **Density** (`density`): **Comfortable** (default) · Compact
- **Locale** (`locale`): **English (US)** (default) · Deutsch

## Pinned states (7)

- Role: Employee, Expense lifecycle: Draft — Owner can still edit
- Role: Manager, Expense lifecycle: Submitted — Approve / reject / request changes
- Role: Manager, Expense lifecycle: In review
- Role: Finance, Expense lifecycle: Approved — Finance marks reimbursed
- Role: Employee, Expense lifecycle: Rejected
- Role: Finance, Expense lifecycle: Reimbursed — Terminal state
- Role: Manager, Expense lifecycle: Submitted, Density: Compact — Compact density

## Semantic targets (`data-proto`)

- `DetailLayout` — { component: "DetailTemplate", density, locale }
- `ExpenseMeta`
- `ReceiptPreview` — { component: "placeholder", mock: "no real file" }
- `LifecycleTimeline` — { component: "Card + custom timeline", drivenBy: "lifecycle dimension" }
- `AppTopBar` — { component: "AppFrame header", roleAware: true }
- `ApprovalActions`
- `SubmitButton` — { component: "Button", advancesTo: "submitted" }
- `ApproveButton` — { component: "Button", advancesTo: "approved" }
- `RejectButton` — { component: "Button", advancesTo: "rejected" }
- `RequestChangesButton` — { component: "Button", advancesTo: "in-review" }
- `ReimburseButton` — { component: "Button", advancesTo: "reimbursed" }

## Design annotations

1. **Action matrix** (`ApprovalActions`) — Buttons are a function of role × lifecycle: employee edits drafts, manager decides on submitted/in-review, finance reimburses approved. In this prototype the buttons really advance the lifecycle dimension.
2. **Timeline** (`LifecycleTimeline`) — Renders the audit trail up to the current lifecycle stage.

## Scenarios that pass through (2)

- **Manager reviews and approves** — PRD-118 §3, JIRA-ORB-412
  3. Approve it → `ApproveButton` (role=manager, lifecycle=submitted)
  4. Approved → `LifecycleTimeline` (role=manager, lifecycle=approved)
- **Finance reimburses** — PRD-118 §4
  2. Mark as reimbursed → `ReimburseButton` (role=finance, lifecycle=approved)
  3. Done — terminal state (role=finance, lifecycle=reimbursed)

## Canvas notes

- The decision buttons are the crux of PRD-118 §3. Reject and Request-changes branch into the variants further right on this row.

_Generated from protopact.json — do not edit by hand._
