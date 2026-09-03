---
status: done
---

# Complete continuous-improvement onboarding postures for new scopes

## Problem

`scope-improver` already provides scope-local improvement review with
task/owner-question output. It consumes semantic requests rather than a
schedule or broad rolling evidence scan, delegates source changes to builder,
and a successful live `scope.lifecycle.changed: registered` boundary now emits
one initial fingerprinted request through the registered scope's resolved
policy authority. The remaining product gap is selecting and explaining the
onboarding posture, setup readiness, and downstream builder authority.

Without the remaining posture/readiness contract, Add Scope can emit its first
review while still leaving clients unable to explain whether setup permits
proposals or whether downstream builder execution is intentionally disabled.

## Desired Outcome

Complete successful onboarding around the existing automation stack for the
new runtime. Resolve one onboarding mode into existing scope policy and
`scope-improvement` configuration, gate activation on setup readiness, and make
the resulting review/builder authority explainable to clients. Preserve the
existing initial `autonomy.scope-improvement.requested` contract: it carries
`automatic: true`, boundary `initial-onboarding`, the stable scope
guidance/policy fingerprint, and its canonical evidence refs, with a pending
fingerprint and pre-queue admission preventing replay.

Expose three understandable postures without introducing project types:
observe/ask, create proposed tasks, and autonomous builder execution within
explicit write policy. Scope review itself remains proposal-only; the resolved
builder policy and existing guardrails remain authoritative.

## Constraints

- Reuse `scope-improver`, dispatcher, builder, task/owner-question queues,
  workflow definitions, and recovery. Do not create an onboarding
  workflow engine or a second continuous-improvement agent.
- Default to observe/ask with autonomous builder execution disabled.
- Activation occurs only after registry, runtime, trust/policy, project state,
  and required setup are committed. A blocked scope remains registered with an
  explainable readiness state but does not dispatch impossible work.
- Each scope has isolated run ownership, repository sandboxes, events, tasks,
  fingerprint consumption, and recovery state.
- Repeated activation or daemon restart must not duplicate pending runs, tasks,
  or the initial improvement request. Use the consumed/pending fingerprint
  contract and latest-only request coalescing.

## Done When

- A newly onboarded scope's existing semantic initial request is gated by its
  selected posture and setup readiness without daemon restart.
- Its selected onboarding posture resolves through scope policy and existing
  improvement config, and clients can explain what automation may do.
- The first eligible improvement request records its fingerprint and produces
  a task, owner question, or explicit no-action result inside that scope.
- Missing provider/setup, untrusted config, policy denial, and no actionable
  evidence park cleanly without global daemon pause or cross-scope backoff.
- Restart restores exactly one automation registration and preserves
  fingerprint consumption and generated-work dedupe state.

## Source / Intent

Owner request on 2026-07-31: after adding a folder, KOTA should begin ongoing
automated improvement there, potentially improving existing agents or creating
new tasks/workflows as evidence requires. Existing implementation evidence is
in `src/modules/autonomy/workflows/scope-improver/`; this task connects it to
live onboarding rather than replacing it.

## Initiative

Self-service external scope onboarding.

## Acceptance Evidence

- Runtime artifacts for observe/ask and autonomous-builder modes show resolved
  policy, one initial fingerprinted trigger, recommendation/action, and
  isolated scope paths.
- A restart fixture proves the initial fingerprinted trigger is not duplicated.
- A blocked-setup fixture proves one scope parks without pausing or backing off
  healthy sibling scopes.
