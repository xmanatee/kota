---
status: open
priority: p2
---

# Share semantic read-command outcomes across Telegram and Slack

## Problem And Scope

At integrated revision `feceeb978f3909842dcfc4d7a7bfb9f135e03ce3`,
`telegram/status-commands.ts` and `slack-channel/commands.ts` still independently
implement `/memory`, `/knowledge`, `/history`, `/tasks` and `/recall` request and
reply policy. Both repeat missing-query rejection, semantic search with limit 10,
provider-unavailable versus empty replies, and selection of the existing domain
renderer. Slack's `handleMemory`/`handleKnowledge`/`handleHistory`/`handleTasks`/
`handleRecall` mirror Telegram's matching branches. The completed answer-command
task removed a different slice; do not redo its implementation.

The existing memory, knowledge, history, repo-tasks and recall capabilities own
these operations and renderers. Trace their CLI/tool consumers before choosing
where chat reply policy belongs. Own these command branches and direct consumer
proofs, not the underlying search stores, ranking or session lifecycle. No active
task owned this slice when the assessment scanned the queue and empty inbox.

## Outcome And Acceptance

Give each domain's genuinely shared chat request/reply behavior one production
owner and migrate both channel adapters. Remove the replaced branches and
redundant checks together. Keep domain-specific result types and failure meaning;
do not introduce a command DSL, generic result envelope, universal dispatcher or
fixture interpreter merely to share similar syntax.

Both channels must retain trimmed query propagation, empty-input rejection before
client calls, semantic selection and the existing page limit, truthful unavailable
and empty responses, and readable nonempty results. Recall must still call its
single cross-store seam, without channel fan-out or keyword fallback. Selected
scope, admission, command parsing, Telegram truncation and Slack segmentation stay
with their existing channel owners. Preserve transport-error propagation.

Verify shared request/reply behavior at its owner and retain adapter checks for
the distinct parsing, scope and delivery failures. Existing channel tests already
consolidate many result matrices: do not remove necessary adapter routing proof
or claim a large redundant suite without examining it. Capture representative
replies from the real dispatchers with controlled external ports, including an
unavailable provider and a denied/unbound route; no live chat send is required.
Use current verification guidance and report the removed duplication plus local
test, support, exclusion and production deltas separately.

## Preserved Owner Goal

This is an independent implementation follow-up to the superseded
`task-assess-fifty-percent-reduction-after-citation-and-reminder-followups`.
That assessment measured 267,726 executable-test LOC against baseline 334,805,
leaving the owner's 50% minimum (ceiling 167,402) unmet; 70% remains a stretch.
This bounded opportunity does not promise to close the 100,324-line gap and has
no local deletion quota. Preserve useful behavior and protections; do not move
tests into support, minify or disable them. Local completion is the demonstrated
shared behavior and preserved consumer outcomes, not aggregate goal achievement.
