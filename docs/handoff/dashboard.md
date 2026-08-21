# Dashboard

Landing page; content adapts to the viewer's role.

| | |
|---|---|
| id | `dashboard` |
| template | `dashboard-page` — `src/demo/templates/DashboardTemplate.tsx` |
| UI-kit components | Card, Badge, Button, Skeleton, Avatar, Separator |
| organisms | [Work queue](./work-queue.md) |
| fidelity | navigable |
| module | `src/demo/pages/dashboard.tsx` |

## Dimensions

- **Role** (`role`): **Employee** (default) · Manager · Finance
- **Data state** (`state`): **Loaded** (default) · Empty · Loading

## Pinned states (5)

- Role: Employee, Data state: Loaded
- Role: Manager, Data state: Loaded — Manager gets an approvals queue
- Role: Finance, Data state: Loaded — Finance gets a reimbursement queue
- Role: Employee, Data state: Empty — First-run experience
- Role: Employee, Data state: Loading

## Semantic targets (`data-proto`)

- `NewExpenseButton` — { component: "Button", variant: "default", opens: "submit-expense" }
- `StatCards`
- `ActivityFeed` — { component: "Card + list", data: "static fixture" }
- `AppTopBar` — { component: "AppFrame header", roleAware: true }
- `PendingApprovalsCard`
- `ViewQueueLink` — { component: "link", opens: "expenses" }

## Design annotations

1. **Primary CTA** (`NewExpenseButton`) — Always visible for employees; opens the submit flow. Managers/finance reach it via the top nav instead.
2. **Work queue** (`PendingApprovalsCard`) — Role-specific queue: managers see items awaiting their review, finance sees the reimbursement queue. Sorted oldest-first.
3. **Headline numbers** (`StatCards`) — Four KPIs; the set changes per role.

## Scenarios that pass through (2)

- **Employee submits an expense** — PRD-118 §2
  1. Start a new expense → `NewExpenseButton` (role=employee, state=loaded)
- **Manager reviews and approves** — PRD-118 §3, JIRA-ORB-412
  1. From the queue to the full list → `ViewQueueLink` (role=manager, state=loaded)

## Canvas notes

- First-run: one calm CTA, no stats. Resist adding onboarding chrome here until the submit flow is validated.

_Generated from stavy.json — do not edit by hand._
