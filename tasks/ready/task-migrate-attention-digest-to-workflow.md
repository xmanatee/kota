---
id: task-migrate-attention-digest-to-workflow
title: Migrate attention digest to a built-in workflow definition
status: ready
priority: p2
area: runtime
summary: The attention digest fires as a raw daemon subscription today, bypassing the workflow surface. Moving it to a proper workflow definition makes it observable, testable, and consistent with ARCHITECTURE.md's single-automation-surface principle.
created_at: 2026-03-29T22:35:00Z
updated_at: 2026-03-29T22:35:00Z
---

## Problem

`subscribeAttentionDigest` in `src/workflow/attention-digest.ts` is wired
directly as a daemon event subscription in `daemon-subscriptions.ts`. It fires
ad hoc inside the daemon process without appearing in workflow history, cost
tracking, run artifacts, or `kota workflow list` output.

ARCHITECTURE.md is explicit: "Do not add a second scheduling or hook engine.
All automation, regardless of its trigger shape, should go through the workflow
surface." The attention digest is automation — it observes run history, detects
failure streaks and budget pressure, and sends Telegram messages. It belongs on
the workflow surface.

The failure alert and approval notification are real-time reactive handlers
(fire immediately on an event, must not be delayed) — those can stay as daemon
subscriptions. The attention digest is periodic/aggregate work that is a
natural fit for a code-step workflow triggered every N completed runs or on a
schedule.

## Desired Outcome

The attention digest becomes a built-in workflow (`src/workflows/attention-digest/`):
- Triggered on a schedule or after N workflow completions (not a raw daemon subscription)
- Runs as a `code` step that calls the existing digest logic
- Its runs appear in `kota workflow list` and `.kota/runs/`
- `subscribeAttentionDigest` and its wiring in `daemon-subscriptions.ts` are removed

## Constraints

- Reuse the existing `src/workflow/attention-digest.ts` logic — do not rewrite
  the detection or formatting code. Only wrap it in a workflow step.
- The digest trigger should not be more frequent than the existing
  `DIGEST_EVERY_N_RUNS` cadence. A schedule trigger (`intervalMs`) or an event
  counter approach are both acceptable.
- Do not touch `failure-alert.ts` or `approval-notification.ts` — those are
  real-time event handlers that should stay as daemon subscriptions.
- The digest workflow must still have access to `projectDir` and `runsDir`
  through the step context.

## Done When

- A `src/workflows/attention-digest/workflow.ts` exists with a schedule or
  event-based trigger and a code step that runs the digest logic.
- `subscribeAttentionDigest` is removed from `daemon-subscriptions.ts`.
- `src/workflow/attention-digest.ts` is updated or reorganized as needed.
- Digest runs appear in `kota workflow list` output.
- Existing attention digest tests pass; the workflow definition has at least
  a basic smoke test.
