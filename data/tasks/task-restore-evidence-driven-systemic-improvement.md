---
status: open
priority: p1
---
# Restore evidence-driven systemic improvement

## Problem

The workflow named improver currently dispositions one autonomy issue revision
per run. That is useful incident triage, not the cross-run learning requested by
the owner. Progress review admits task blocked/dropped, explicitly labelled
strategic completion, parked transitions and owner decisions; it advances its
commit watermark even when rejecting a boundary. Source/test growth, recurring
repair families and changed delivery yield can therefore accumulate unseen.
Its default packet is 24h/20 runs/10 commits. Full evidence remains discoverable,
but that default is not a long-horizon comparison. Scope-improver is also inert:
dispatcher reports initial onboarding request has not been prepared; zero runs
appear in the retained August 26-September 9 database.

Inspect improver/workflow.ts and prompt.md, dispatcher/semantic-reflection.ts,
semantic-task-transitions.ts, semantic-scope-reflection.ts, scope-improvement-
onboarding, progress-reviewer/progress-review/constants.ts and scope-fingerprint.ts.
The archived semantic-reflection task intentionally stopped wasteful per-build
reviews; preserve that lesson without preserving a gate that suppresses learning.

## Desired Outcome

Give cross-run improvement one clear existing owner: progress-reviewer owns
systemic operational/product learning; improver owns incident disposition;
architecture-gardener owns code-structure opportunities; scope-improver owns
scope guidance/policy. Make these roles discoverable, with common proposal/topic
deduplication and explicit handoff, not overlapping bots reviewing the same runs.

Replace the narrow strategic admission with a durable, coalesced evidence window.
Useful inputs include delivery/repair changes, recurring root-cause families,
review yield, real queue availability, cross-owner change fanout, structural
signals and owner feedback. Let an agent inspect a bounded summary plus scoped
raw references, challenge hypotheses and choose no action, one coherent change,
or a handoff. Do not encode architectural conclusions in thresholds or text matches.
Evidence sufficiency depends on the decision; neither every N builds nor a clock
is by itself enough. Cheap reconciliation may wake to discover changed evidence.

Retain consumed/pending evidence identity through the existing revisioned state
and semantic request machinery. Repeated idle, completion+commit events, restart,
or a review of a review must not multiply one decision. Follow an accepted
intervention to its integrated result and later outcome; task creation is not
proof of improvement. Reconcile eligible pre-existing scope initialization
through its existing lifecycle owner without fabricating onboarding events.

## Constraints

- Replace conflicting gates/prompts, do not append another review workflow,
  event ledger, scoring DSL, mandatory critic or universal repair supervisor.
- Keep builder capacity primary when useful independent work exists; urgency
  may justify immediate security/incident work. No arbitrary task production goal.
- Use the claim-aware queue task's public projection when available; do not
  copy ownership calculations. Guidance/policy scope review remains distinct
  from generic source review.

## How We Will Know

Replay a pinned available cohort spanning successful delivery, repeated failure,
review churn and an intervention. Show admitted and rejected evidence windows
with reasons, no duplicate decision after restart, and a follow-up result that
can reject the original hypothesis. Verify current eligible scope initialization
can produce a scoped request exactly once. Observe a real systemic decision
using cross-run evidence, or an honest evidence-insufficient disposition, without
reintroducing per-build agent reviews.

## Research Basis

https://sre.google/workbook/monitoring/ and
https://sre.google/workbook/eliminating-toil/ favor actionable outcomes and root
causes. https://www.anthropic.com/engineering/building-effective-agents favors
simple composable patterns; extra evaluator/optimizer work needs a measurable role.