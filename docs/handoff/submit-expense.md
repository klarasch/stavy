# Submit expense

Multi-step submission flow; each step is a value of the 'step' process dimension.

| | |
|---|---|
| id | `submit-expense` |
| template | `form-flow-page` — `src/demo/templates/FormFlowTemplate.tsx` |
| UI-kit components | Card, Progress, Input, Label, Select, Textarea, Button |
| organisms | [Flow progress](./flow-progress.md) |
| fidelity | interactive |
| module | `src/demo/pages/submit-expense.tsx` |

## Dimensions

- **Flow progress** (`step`): **1 · Details** (default) · 2 · Receipt · 3 · Review · 4 · Done

## Pinned states (4)

- Flow progress: 1 · Details
- Flow progress: 2 · Receipt
- Flow progress: 3 · Review
- Flow progress: 4 · Done — Confirmation; links back to the list

## Semantic targets (`data-proto`)

- `ContinueButton` — { component: "Button", advancesTo: "receipt" }
- `ReceiptDropzone` — { component: "custom dropzone", mock: "upload is faked" }
- `SubmitButton` — { component: "Button", advancesTo: "done", sideEffect: "lifecycle → submitted" }
- `ViewExpensesButton` — { component: "Button", opens: "expenses" }
- `AppTopBar` — { component: "AppFrame header", roleAware: true }
- `FlowProgress`

## Design annotations

1. **Process dimension** (`FlowProgress`) — The step indicator is driven by the 'step' dimension — every stage of the process is addressable and appears on the canvas.
2. **Mocked upload** (`ReceiptDropzone`) — Upload is faked in the prototype; any interaction marks a receipt as attached.

## Scenarios that pass through (1)

- **Employee submits an expense** — PRD-118 §2
  2. Fill in the details → `ContinueButton` (step=details)
  3. Attach a receipt → `ContinueButton` (step=receipt)
  4. Review and submit → `SubmitButton` (step=review)
  5. Confirmation → `ViewExpensesButton` (step=done)

## Canvas notes

- Upload is deliberately mocked — static first. Real file handling only if a scenario needs to demonstrate it.

_Generated from protoscope.json — do not edit by hand._
