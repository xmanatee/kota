---
status: done
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

## Completion Evidence

Memory, knowledge, history, repo-tasks and recall now each own their chat
request/reply policy in `commands.ts`. Both channel dispatchers delegate to
those owners with the selected client. The four search commands require semantic
ranking with limit 10; recall calls only its existing cross-store seam. Domain
result unions and renderers remain intact. CLI/tool inputs retain their distinct
filter, limit, error and structured-output behavior.

Removed both copies of the five request/result branches and Slack's redundant
page-limit declaration. Replaced repeated adapter empty-input checks with owner
coverage while retaining routing, parsing, admission and delivery checks. Added
explicit read-reply truncation/segmentation and failed-delivery checks.

Validation in builder run `2026-09-13T08-43-01-832Z-builder-1wa0ca`:

- `pnpm check:fast` completed, including production/test types, lint, task
  validation, generated binding checks and admission of 90 bundled modules.
- Focused owner/adapter/admission tests passed: 27 tests initially, followed by
  15 tests in the two updated adapter suites after adding delivery coverage
  (29 distinct final tests across the nine selected files). Domain tests cover
  blank/trimmed input, semantic defaults, unavailable/empty/nonempty results and
  transport failure. Slack admission checks reject unauthorized routes.
- The existing Telegram scope integration file passed both tests, distinguishing
  selected-scope routing from default leakage, unbound routing and draining-scope
  rejection.
- `read-command-transcript.json` in the run directory records 13 actual dispatcher
  exchanges through controlled client and HTTP ports, including unavailable and
  empty replies, readable results, single-seam recall, usage, and an unbound chat
  with zero search calls. `read-command-probe.mjs` retains the executable probe.
  No live chat messages were sent.

`local-deltas.json` records scoped physical-line counts versus the writer's HEAD
(including blank lines/comments): production 687 → 563 (−124), executable test
files 256 → 421 (+165), repository support 0, exclusions 0. The existing channel
suites had no large duplicate result matrix to delete. The run-only probe is
separate evidence, not relocated tests or repository support. No aggregate
50%/70% reduction achievement is claimed. Native contracts, stores, ranking,
sessions and runtime lifecycle did not change; full release/live evaluations
were not selected for this bounded chat-policy change.
