---
id: task-prove-seventy-percent-test-loc-reduction
title: Audit and prove seventy percent test LOC reduction
status: backlog
priority: p1
area: architecture
summary: Reconcile the final verification portfolio, prove at least 70 percent executable test LOC reduction without support displacement, and remove temporary migration tracking.
task_class: Meta
depends_on: [task-collapse-root-integration-and-test-support]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

A large deletion can hit a line target while retaining duplicated production mechanisms, moving code into helpers or fixtures, weakening critical behavior, or leaving stale instructions that recreate the problem. Completion therefore needs a portfolio and architecture audit, not only a count.

## Desired Outcome

The final repository has a reconciled owner and cadence inventory, at most 30 percent of the frozen executable-test baseline, materially lower authored test-support LOC, no hidden displacement, and explicit retained confidence for protocol, security, durability, recovery, destructive action, and operator journeys. Temporary tracking artifacts are removed after the anchor is closed.

## Constraints

- Use the baseline and accounting rules established by the standards slice; explain any corrected baseline transparently.
- Sample meaningful mutations or equivalent counterfactual failures at high-risk owners rather than chasing a universal mutation score.
- Audit production LOC and mechanisms for duplicate owners, compatibility aliases, shadow paths, ambient state, and overengineering.
- Do not turn the initiative's LOC target into a permanent CI or autonomy gate.

## How We Will Know

- Executable test LOC is reduced by at least 70 percent and target margin is reported; authored support and fixture LOC did not absorb the deleted code.
- All retained tests satisfy consumer, owner, public stimulus, observable oracle, distinct failure, and cadence admission or have a documented exceptional reason.
- Sampled high-risk defects are caught by their intended mechanisms, and intentionally untested risks are explicit decisions.
- No obsolete stage tasks, temporary reports, inventories, compatibility paths, or misleading automation instructions remain.
