# Work queue (component)

Bespoke organism: the role-aware queue card from the dashboard.

| | |
|---|---|
| id | `work-queue` |
| template | `work-queue-organism` — `src/demo/organisms/WorkQueue.tsx` |
| UI-kit components | Card, Badge, Skeleton |
| frame | 720 × 420 |
| fidelity | navigable |
| module | `src/demo/components/work-queue.tsx` |

## Dimensions

- **Role** (`role`): Employee · **Manager** (default) · Finance
- **Data state** (`state`): **Loaded** (default) · Empty · Loading

## Pinned states (5)

- Role: Employee, Data state: Loaded
- Role: Manager, Data state: Loaded
- Role: Finance, Data state: Loaded
- Role: Manager, Data state: Empty
- Role: Manager, Data state: Loading

## Semantic targets (`data-proto`)

- `PendingApprovalsCard`
- `ViewQueueLink` — { component: "link", opens: "expenses" }
- `AppTopBar` — { component: "AppFrame header", roleAware: true }

## Design annotations

1. **Sort order** (`PendingApprovalsCard`) — Managers and finance see oldest-first; employees see latest-first.

## Scenarios that pass through (0)


_Generated from protoscope.json — do not edit by hand._
