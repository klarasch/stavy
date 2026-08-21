# Approval actions (component)

Bespoke organism: the decision panel, reviewable on its own.

| | |
|---|---|
| id | `approval-actions` |
| template | `approval-actions-organism` — `src/demo/organisms/ApprovalActions.tsx` |
| UI-kit components | Card, Button |
| frame | 560 × 340 |
| fidelity | navigable |
| module | `src/demo/components/approval-actions.tsx` |

## Dimensions

- **Role** (`role`): Employee · **Manager** (default) · Finance
- **Expense lifecycle** (`lifecycle`): Draft · **Submitted** (default) · In review · Approved · Rejected · Reimbursed

## Pinned states (5)

- Role: Employee, Expense lifecycle: Draft
- Role: Manager, Expense lifecycle: Submitted
- Role: Manager, Expense lifecycle: In review
- Role: Finance, Expense lifecycle: Approved
- Role: Employee, Expense lifecycle: Approved — Empty state of the panel

## Semantic targets (`data-proto`)

- `ApprovalActions`
- `SubmitButton` — { component: "Button", advancesTo: "submitted" }
- `ApproveButton` — { component: "Button", advancesTo: "approved" }
- `RejectButton` — { component: "Button", advancesTo: "rejected" }
- `RequestChangesButton` — { component: "Button", advancesTo: "in-review" }
- `ReimburseButton` — { component: "Button", advancesTo: "reimbursed" }

## Design annotations

1. **Primary decision** (`ApproveButton`) — Always first; Reject is secondary, Request changes is tertiary so the happy path reads top-down.

## Scenarios that pass through (0)


## Canvas notes

- Registered as its own component so the decision matrix can be signed off without the page around it. Same contract, smaller frame.

_Generated from protoscope.json — do not edit by hand._
