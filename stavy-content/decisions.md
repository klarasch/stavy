# Decisions

Design decisions made in conversation, newest first: what, why, what else was on the table.

## 2026-10-17 — Rejecting an expense always asks for a reason

**Why:** Employees were resubmitting rejected expenses unchanged; a required reason makes the rejection actionable.
**Alternatives:** An optional comment field; a fixed list of reasons only.
**Status:** decided

## 2026-10-12 — Managers approve up to 500; above that, a second approver

**Why:** Matches the finance policy in the PRD and keeps the common path to a single click.
**Alternatives:** One approver at any amount; thresholds per team.
**Status:** decided

## 2026-10-09 — Show approval as a flow, not a screen per role

**Why:** The same expense looks different to each role; a flow keeps one story and lets each step show its role's view.
**Alternatives:** A board per role; a role switcher on every screen.
**Status:** open: waiting on the review
