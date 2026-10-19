# Approval rules

Who can do what to an expense, and when. This is the written half of the
[Approval story](?b=approval-story) board; every picture below is a live state
of the prototype — click one to open it.

## Who approves

- **Employees** submit their own expenses and can edit a draft until they do.
- **Managers** decide on expenses submitted by their reports: approve, reject,
  or request changes once.
- **Finance** reimburses approved expenses. Finance never approves.

![A submitted expense, as the manager sees it](stavy:expense-detail?role=manager&lifecycle=submitted)

## Approval limits

| Amount | Approved by | Notes |
|---|---|---|
| up to 500 | Manager | The normal path |
| 500 – 5,000 | Manager, then Finance | Flagged in the queue |
| over 5,000 | Not allowed | Split into separate claims |

A rejected expense goes back to the employee with the reason; they can revise
and resubmit, which starts the approval again.

## States an expense moves through

1. `draft` — only the employee sees it
2. `submitted` — waiting in the manager's queue
3. `in-review` — changes were requested; one round only
4. `approved` or `rejected`
5. `reimbursed` — paid out by finance

![Finance's view of an approved expense](stavy:expense-detail?role=finance&lifecycle=approved&expense=exp-2102)

## Empty and error states

The list never shows a blank table: an empty list says why and offers the
next step.

![No expenses yet](stavy:expenses/empty)
