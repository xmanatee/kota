---
id: task-stop-research-retry-re-confirmation-churn-when-cap
title: Stop research-retry re-confirmation churn when capability preconditions are absent
status: backlog
priority: p2
area: architecture
summary: When authenticated / rendered browser capability is unavailable (Playwright not installed, no auth profile) or every candidate URL has been re-confirmed inaccessible since the task last changed, research-retry should skip without invoking the builder agent, so the autonomy loop stops producing re-confirmation commits that add no signal.
created_at: 2026-04-22T23:45:06.228Z
updated_at: 2026-04-22T23:45:06.228Z
---

## Problem

`src/modules/autonomy/workflows/research-retry/` triggers on
`autonomy.queue.available` and runs an agent over the oldest blocked task
that carries a `## Resources` section. The workflow was designed to unblock
research leads once authenticated / rendered browser capability is
provisioned. In the current environment that capability is not provisioned
— `task-enable-autonomous-access-to-auth-walled-sources-so` is blocked on
an operator step (Playwright install + X login) — so every autonomous cycle
picks up the same blocked research tasks, retries the same auth-walled X
URLs, and produces a commit titled "Re-confirm research-retry blocker".

`git log --since="14 days ago"` shows 15+ consecutive "Re-confirm
research-retry blocker" commits in 547 total. That is roughly one in every
30 commits spent re-confirming the same blocker with no new information,
consuming Opus turns and cost budget and crowding the run artifact
directory with no-signal runs.

## Desired Outcome

Research-retry produces a commit only when something meaningful changed.
When the tools the workflow depends on are not actually available in the
environment, or when every candidate URL has already been confirmed
inaccessible since the candidate task last changed, the workflow skips the
agent step and exits without committing. The blocked research tasks stay
honestly blocked, and the queue stops inflating with no-signal runs.

## Constraints

- Keep the workflow definition-driven and typed. Preconditions belong in
  `inspect-candidates` (or a sibling typed step) exposed to the agent
  gating `when` predicate — not in prompt instructions asking the agent to
  self-police.
- Do not add a generic "capability registry" in core for this. Detect the
  specific condition the research-retry workflow already depends on
  (rendered-browser / authenticated-browser reachability) from the module
  surfaces that already own it (`src/modules/browser/`), or bail on a
  precondition the workflow can observe cheaply (config-absent storage
  state, Playwright dynamic import failure).
- Do not store per-task attempt history in a second state surface. If a
  "last attempted at" fingerprint is needed to detect "nothing changed
  since last retry", store it on the blocked task body itself (the same
  body that carries `## Resources`) so the evidence stays co-located with
  the task.
- Respect the recovery contract: the reset-for-recovery step still runs on
  `runtime.recovered`; only the agent step is gated. An added precondition
  must be idempotent and have no network side effects at the reset path.
- Keep the honest-blocker policy intact. Skipping is not the same as
  marking a task done. A skipped run leaves the blocked task as-is with
  no commit.
- No silent fallback to the old "always re-confirm" behavior. Either the
  precondition is met and the agent runs, or the precondition is not met
  and the workflow exits without commit.
- Do not add a hard daily cap on research-retry as a substitute for this
  — `src/AGENTS.md` rules out throttling autonomous workflows with spend
  caps instead of fixing the queue shape.

## Done When

- `research-retry` does not produce a commit when its capability
  preconditions are unmet or when every candidate URL was already
  re-confirmed inaccessible since the task's `updated_at`.
- The inspection step surfaces the precondition outcome so an operator
  reading `<run-dir>/steps/inspect-candidates.json` can see why the agent
  step was skipped.
- A focused workflow test covers the skip cases (capability absent,
  nothing changed since last attempt) alongside the existing
  candidate-present case. Tests must not depend on a real Playwright
  install.
- `src/modules/autonomy/workflows/research-retry/AGENTS.md` documents the
  skip contract at convention level (what triggers a skip, why skipping
  is correct) — no function inventory, no repro log.
- After this change lands, a subsequent 14-day autonomy window shows no
  "Re-confirm research-retry blocker" commits against an unchanged
  candidate set. That evidence belongs in the run artifact and git
  history; do not add a durable metric surface for it.
