---
status: done
---
# Settle gardener decisions against relevant evidence

## Problem

Follow-up to archived task-make-the-architecture-gardener-an-evidence-led-age
(de1449038), not another gardener. The agent, scoped request path and removal of
fabricated scoring are useful. Two live-contract gaps remain.

admission.ts fingerprints all structural observations and delivery follow-ups;
any changed delivery counter can admit unchanged architectural evidence when
both kinds exist. Eight inspected Sept 9-10 runs had unchanged non-delivery
fingerprints; five invoked an agent, yielding one no-action and four covered
decisions. Exact JSON equality is not meaningful new information.

gardener-task.ts returns an existing generated task unchanged even when it is
terminal and the decision proposes new work. workflow.ts can record proposed
and consume the cohort despite touchedTaskQueue=false. A decision is not a
delivered task, and a done task is not automatically coverage of new evidence.

## Desired Outcome

Use existing review state and generated-work/task publication owners to retain a
settled judgment and its relevant revisit condition. New structural evidence or
materially changed delivery friction can warrant review; unrelated incident
increments do not automatically invalidate it. Permit explicit justified review,
false-positive rejection and no-action. Do not introduce scores, count thresholds,
another scheduler or a general semantic-equivalence engine.

Make proposal settlement truthful: distinguish unchanged/covered, an applied
update or authorized reopen, and deferred publication against an active owner.
New validated evidence may reopen the relevant terminal task with explicit
priority using the existing task lifecycle, not silently create duplicate work.
Consume proposal evidence only with a durable truthful disposition. Preserve the
existing ownership and integration contracts; do not mutate a held task directly.

## How We Will Know

At the existing owner boundary, unchanged structural evidence plus irrelevant
friction churn does not repeat investigation, meaningful change admits once,
and a new proposal against terminal/active tasks is applied or honestly deferred.
One live grounded decision links to the actual task mutation or justified no-op.
Review all callers of the common generated-work materializer before changing it;
test shared lifecycle behavior there, not repeatedly in every workflow.

## Completion evidence

Gardener now retains the reviewed judgment, a revisit reason, and the observed
delivery issue keys relevant to that judgment. It reuses the issue owner's
semantic fingerprint, which already excludes raw occurrence counts. Unrelated
issue churn no longer reopens settled structural evidence; structural changes,
relevant issue changes, justified requests, and linked terminal evidence remain
admissible. False-positive rejection and no-action remain complete decisions.

Proposal settlement records applied, unchanged, covered, or deferred outcomes.
Revised proposals against active tasks retain their full decision for later
terminal review without editing the active contract. Grounded terminal proposals
reuse the shared generated-work lifecycle and the same task id with an explicit
priority. The publication invariant checks both the reviewed canonical task and
the applied task in the reconciled writer before publishing its disposition.

Reviewed the shared staging callers in improver, progress-reviewer, scope-improver,
and gardener, plus the immediate materialization path. The shared production
materializer already supplied the required lifecycle, so it remains unchanged;
its owning tests now explicitly verify priority propagation and unchanged replay.

Critic repair preserves the handoff proposal identity through deferred and
no-action reviews, so automatic terminal follow-ups after restart reopen the
same task. Every task-dependent settlement now fingerprints the task by id and
validates both canonical and reconciled task content, including unchanged,
covered, and deferred decisions that do not mutate the queue.

Validation after critic repair: 62 owner tests across nine files passed, including production workflow
scenarios for irrelevant incident churn, relevant changes admitted once, restart,
deferred proposals, automatic terminal reopening after restart, and stale
publication rejection for applied and non-mutating settlements.
`pnpm check:fast`, final production/test typechecks, focused lint, and diff
whitespace checks passed. Task integrity was revalidated after archival.

Run `2026-09-10T02-03-16-222Z-builder-91e2py` retains `owner-tests.log`,
`typecheck.log`, and `grounded-decision.json` in its agent run directory. The live
local assessment inspected the current source and task, returned `covered` for
this active contract through the production gardener materializer, and verified
identical task-queue hashes before and after. This was the current builder's
grounded decision, not a separately launched gardener model evaluation; no
long-term reduction in investigation cost or model-quality improvement is claimed.
`repair-validation.txt` records the critic repair verification and its limits.

The second critic repair retains all proposal identities and task links for a
scope when another mechanism is reviewed. The production workflow regression
first reproduced three tasks for two handoff topics. After repair, automatic
and scoped follow-ups across restart reopen the original task, preserve the
second task, and suppress replay. The gardener/shared-materializer owner suite
passed 37 tests across eight files; both follow-up variants then passed after
adding the scoped case. `pnpm check:fast`, the final test typecheck, focused lint,
and whitespace checks passed. These controlled-agent scenarios prove durable
identity and task settlement, without claiming new live model evaluation.

The third critic repair preserves proposal identities and linked task evidence
across overlapping repository, directory, and file review scopes. Before repair,
four scope-transition regressions each created a third task for two handoff
topics. Follow-ups now resolve the original topic through normalized ancestor
and descendant paths; similarly prefixed sibling paths remain separate.
Validation passed: 43 tests across the gardener and shared materializer owner
suites, pnpm check:fast, final test typecheck, focused lint, task validation,
and whitespace checks. Controlled workflow scenarios verify restart, task-id
reuse with explicit priority, unchanged replay suppression, and disjoint-path
ownership; they do not claim a new live model evaluation.

The fourth critic repair preserves the original scope on each proposal identity
when a broader review reuses it. Later sibling requests neither inherit that
task's ownership nor consume its linked task evidence. Publication now checks
linked and explicitly cited task evidence even for no-action judgments, against
both canonical state and the reconciled writer; unrelated task changes remain
valid. The regression scenarios use the production workflow and publication
invariant with controlled agent decisions.

Final validation for this repair passed: 24 workflow tests plus 21 tests in the
other seven gardener/shared-materializer owner files; pnpm check:fast; final
test typecheck and focused lint; task validation and whitespace checks. The
initial new fixtures required committing terminal evidence in their disposable
repositories before isolated workflow execution. All corrected workflow cases
pass. No additional live model evaluation or efficiency claim is made.

The fifth critic repair recovers proposal identities omitted by the original
state format from retained gardener run artifacts. Recovery checks each proposal
key against the linked generated task and retains its mechanism and target scope
in transactional review state. Automatic and scoped terminal follow-ups now reopen
the original handoff task after upgrade; missing or mismatched identity evidence
cannot create replacement work. The shared generated-work lifecycle remains the
publication owner.

Both upgrade regressions first reproduced two tasks where one should remain.
They now verify the original id, requested priority, revised task content, replay
suppression, and a later reopening after removal of the historical artifact.
Negative cases retain the terminal task when identity evidence is missing or
mismatched. Validation passed: 49 owner tests across eight gardener/shared-work
files, the four strengthened upgrade cases, the scoped API/CLI integration
scenario, pnpm check:fast, final test typecheck, focused lint, and scoped whitespace
checks. The integration fixture now supplies the required revisit condition and
repeats the same request reason when checking suppression. Logs are retained as
repair-5-*.log in the builder agent directory. These are controlled-agent runtime
proofs, not a new live model-quality or efficiency evaluation.

The sixth critic repair retains unresolved historical task identities independently
of scoped delivery evidence. A later topic's disposition can no longer hide an
earlier linked owner from the duplicate-work guard. The strengthened two-topic
upgrade fixture reproduced incorrect success for both module and file requests
before the fix. All 51 gardener/shared-materializer owner tests now pass,
including missing/mismatched evidence rejection, attributable identity recovery,
restart, reopening, and preservation of the other task. `pnpm check:fast` passed;
logs are retained as `repair-6-*.log` in the builder agent directory. These
controlled-agent workflow proofs establish identity preservation, without a new
live model-quality claim.

The seventh critic repair decodes retained gardener artifacts by schema version.
Earlier score-based records no longer prevent recovery from later attributable
proposal evidence. The existing six upgrade scenarios first reproduced the
failure with mixed historical versions, then passed with the fix, including
missing/mismatched identity rejection and durable reopening of the original task.
All 51 gardener/shared-materializer owner tests and `pnpm check:fast` passed;
logs are retained as `repair-7-*.log` in the builder agent directory. These
controlled-agent workflow scenarios prove upgrade recovery, not live model quality.
