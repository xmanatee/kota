---
id: task-prove-inbound-workflow-notifications-cannot-resolv
title: Prove inbound workflow notifications cannot resolve operator approvals
status: backlog
priority: p2
area: security
task_class: Safety
summary: Add a regression/audit proving scheduled, webhook, and inbound-signal workflow deliveries cannot answer or approve pending operator prompts except through explicit authenticated operator routes.
created_at: 2026-06-21T06:07:47.113Z
updated_at: 2026-06-21T06:07:47.113Z
---

## Problem

KOTA has several paths that deliver non-operator events into the runtime:
scheduled workflow triggers, signed webhook triggers, inbound signals from
channel adapters, and notification modules that surface pending approvals and
owner questions. The approval and owner-question queues are intentionally
resolved through explicit operator-control routes or trusted channel-specific
callbacks, but there is no focused regression that proves ordinary inbound
workflow deliveries cannot be misclassified as operator input for a pending
approval or owner decision.

Claude Code 2.1.183 fixed the same class of boundary bug in its runtime:
scheduled task and webhook trigger deliveries had been treated like keyboard
input and could approve a pending action in auto mode. KOTA already keeps
workflow triggers, approval queues, owner-question queues, Telegram callbacks,
and inbound-signal intake as separate modules, but the safety property should
be executable rather than inferred from module structure.

## Desired Outcome

Add a focused safety regression or audit that creates pending approval and
owner-question/owner-decision prompts, then delivers scheduled, webhook, and
inbound-signal workflow events containing plausible approval text. The test
must prove those event payloads remain trigger data only: they can start or
resume the intended workflow, but they cannot resolve the pending operator
prompt, set a decision value, or mark an approval accepted/rejected unless the
request reaches an explicit authenticated operator route or a channel callback
whose provenance is already allowed to resolve that prompt.

## Constraints

- Keep the fix within existing workflow trigger, inbound-signal,
  approval-queue, owner-question, and channel callback concepts. Do not add a
  second approval queue, a parallel "operator input" store, or a broad policy
  registry.
- Preserve legitimate operator surfaces: CLI/HTTP daemon-control routes,
  web/native clients, Telegram inline approvals, and tracked Telegram
  owner-question replies should continue to resolve the matching prompt when
  authenticated and scoped correctly.
- Treat webhook, scheduled, file-watch, and inbound-signal payload text as
  untrusted trigger data. Screening or validation can reject unsafe payloads,
  but it must not silently convert payload text into owner approval.
- Keep the regression deterministic. It should not require network access,
  real Telegram/Slack/GitHub traffic, provider keys, or live agent calls.

## Done When

- A regression test covers at least one pending tool approval and one pending
  owner-question or owner-decision prompt while delivering non-operator
  scheduled, webhook, and inbound-signal payloads that include approval-like
  words such as `approve`, `yes`, or an allowed option id.
- The test proves the pending records remain pending after those event
  deliveries, including project scope where relevant.
- The same test or a paired positive test proves an explicit authenticated
  operator route or allowed channel callback still resolves the prompt.
- Any necessary runtime guard names the rejected source clearly in logs,
  returned errors, or run artifacts without exposing secrets.
- `pnpm run validate-tasks -- --min-ready 0` passes, and the focused test command
  for the new boundary passes.

## Source / Intent

Explorer run `2026-06-21T05-27-12-399Z-explorer-gxs6zd` reviewed a thin queue
with two fresh actionable tasks and no backlog reserve. The strategic blocked
alternatives all still require operator-captured artifacts and were not
movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

External source checked:

- `https://github.com/anthropics/claude-code` changelog, version 2.1.183.
  The relevant safety signal is that scheduled task and webhook trigger
  deliveries were explicitly fixed so they are classified as task
  notifications and cannot approve pending actions or set session titles in
  auto mode. KOTA should assert the same boundary for its own workflow trigger
  and operator-prompt surfaces.

Local overlap check:

- Existing tasks have shipped approvals, owner questions, workflow triggers,
  webhook routing, Telegram inline approvals, Telegram owner-question replies,
  project-scoped approval queues, and inbound-signal screening.
- No open task or completed regression found in the queue search explicitly
  proves that non-operator scheduled/webhook/inbound workflow payloads cannot
  resolve a pending approval or owner-question prompt.

## Initiative

Operator authorization boundary: KOTA should keep automated runtime events and
human approval/owner input as separate authority classes, even when both flow
through the same daemon and workflow runtime.

## Acceptance Evidence

- Focused test transcript showing scheduled, webhook, and inbound-signal
  approval-like payloads do not resolve pending approvals or owner questions.
- Positive control transcript showing authenticated CLI/HTTP or allowed channel
  callback resolution still works for the matching prompt.
- Any runtime diagnostics or run artifact showing the source classification
  used for rejected non-operator event payloads.
