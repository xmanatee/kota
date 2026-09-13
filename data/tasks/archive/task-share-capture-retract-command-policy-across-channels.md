---
status: done
---

# Share capture and retract command policy across Telegram and Slack

## Problem And Scope

At integrated revision `feceeb978f3909842dcfc4d7a7bfb9f135e03ce3`, Telegram's
`handleCaptureCommand` and Slack's `handleCapture` separately reject empty text
by constructing the same ambiguous CaptureResult with CAPTURE_TARGET_ORDER,
construct the optional target filter, invoke capture and render the reply.
Telegram's `handleRetractCommand` and Slack's `handleRetract`/`buildRetractRequest`
repeat empty-identifier handling and command-to-target request construction.
The capture/retract owners already expose typed clients and reply renderers.

Own these shared mutation-command policies and the two adapters' direct
consumers. Keep actual persistence in the current store/repo-task owners.
Do not reopen the completed answer-command work or the independent semantic
read-command follow-up. The queue and inbox scan found no active owner for this
remaining duplication.

## Outcome And Acceptance

Put shared capture and correction request/reply behavior with the existing
capture and retract capabilities, then remove the replaced channel branches.
Use the existing target unions and renderers; no new mutation engine, contributor
registry, compatibility envelope or generic command interpreter is needed.

Keep untargeted capture distinct from an explicit target, retain complete
multiline content, and reject empty bodies before writes. Preserve all four
targets, exact identifier forwarding, ambiguous-target guidance, typed rejection
and failure replies, and successful task retraction's previous-path to archived
path/dropped-state wording. An explicit task capture must still use the validated
repo-task mutation boundary. Preserve channel-specific parsing and `/retract`
help/routing behavior, scope selection, admission, output limits and delivery.
Do not add channel-side classification, direct store writes or new approvals.

Exercise shared command policy once at its owner; retain each channel's target
mapping and delivery proof where it detects a distinct failure. Existing channel
tests are already small, so prove production simplification rather than pursuing
test deletion for its own sake. Capture representative dispatcher replies and
selected-scope effects through existing real domain owners with controlled
external ports; denied or empty input must produce no mutation. Preserve existing
store/repo-task safety proofs without repeating every persistence case in chat
tests. Run affected checks under current verification guidance and report local
test, support, exclusion and production deltas separately.

## Preserved Owner Goal

This independent implementation task supersedes part of
`task-assess-fifty-percent-reduction-after-citation-and-reminder-followups`.
Its 267,726 executable-test LOC result leaves the owner's 50% minimum against
334,805 (ceiling 167,402) unmet, with 70% as a stretch. This task has no local
quota and does not claim to close the 100,324-line gap. Preserve useful behavior
and checks; no reclassification, minification or disabled tests. Judge local
completion by removed duplication and preserved consumer outcomes; aggregate
goal achievement remains unestablished.

## Completion

Capture and retract now own shared chat command replies, empty-input rejection
and typed request construction. Telegram and Slack retain parsing, target
mapping, scope/admission and delivery. Store transforms and mutation authority
are unchanged; retract slash-command types derive from the existing target union.

Owner policy and channel checks passed, including multiline content, all four
targets, untargeted capture, exact identifiers, rejection/failure replies and
archive wording. The dispatcher integration journey uses real providers, scope
selection, task mutation, writer publication and task queue validation; controlled
HTTP, port probes and an in-process validator replace external ports. Its
transcript confirms selected-scope effects and no writes for unbound/empty input.
The existing Telegram routing/drain journey also passed.

`pnpm check:fast` passed. The broader owner selection had 70 passes and one
existing repo-task workflow test unable to allocate ports in this sandbox;
process supervision also encounters `/bin/ps` EPERM. The new journey supplies
controlled ports and runs the actual task validator in process, without changing
production rails. A broader cross-store route test failed in unmodified recall
setup because its temporary `.kota/runtime` directory was absent; its unknown-scope
case passed. These are not claimed as passing checks. No live chat or deployment
exchange was performed. Execution details and dispatcher transcript are retained
in this builder run's artifacts.

Local physical source-line deltas (including comments/imports and fixture setup
inside test files): production -69; executable test files +217 (14 owner cases
and one integration journey added); separate support files 0; exclusions 0;
scoped guidance +1. No existing tests were disabled or deleted. These local
figures do not establish the preserved aggregate reduction goal.
