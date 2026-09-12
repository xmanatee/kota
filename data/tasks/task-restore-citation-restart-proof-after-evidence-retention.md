---
status: open
priority: p1
---

# Reconcile citation and reviewer consumer proofs after runtime evidence retention

## Current Main Review

Reviewed against `ca4dd6dc0bd2c2f4ccad69a7a2c5e289d3d41c3e`. Integrated
`e94bfed2f` already replaces cleanup-time review projection with raw runtime
retention under `retained-runtime/`; cleanup no longer calls
`requireRetainedRunArtifacts`. Do not implement that repair again or assume the
historical citation failure still reproduces. Verify the existing citation
journey against that lifecycle and leave it unchanged if it now passes. Its
fixture and the shadow-review launch assertion below are unchanged on main.
The remaining shadow consumer must follow the current judge/harness contract.
No current-main execution result is claimed by this source comparison.

## Historical Failure And Owner

Published `eb41e8e7c8b0509e8e33cc074f6baa0e950ba4eb` reproducibly fails
`src/modules/autonomy/workflows/progress-reviewer/workflow-citation-correction.test.ts`
case “durably consumes exhausted automatic citations and admits later owner
feedback after restart”. The workflow succeeds and consumes revision 1, but the
next semantic inspection returns `nextState: null` instead of clearing pending.
The actual reason is “systemic evidence is parked until the canonical worktree
is clean”. A diagnostic Git status identifies only an untracked
`.kota/runs/runtime-citation-exhausted/evidence/manifests/<digest>.json`.

The fixture's `workflow.test-helpers.ts` explicitly unignores evidence. Runtime
retention introduced in `d2e5d4450` now creates that manifest. KOTA's actual root
ignores `.kota/`; this observation establishes a broken composed proof, not a
claim that production dispatch is broken. The previous bounded collector task
changed only `workflow.test.ts`, and must not be repeated.

Own the citation-restart scenario and its direct fixture. Consult the production
runtime handoff and dispatcher clean-tree boundary; change those owners only if
a real consumer defect is demonstrated. Do not weaken clean-tree admission,
discard runtime evidence, or fake the consumption/publication state machine.

## Outcome And Acceptance

Verify the real publication/evidence lifecycle in the existing composed
scenario; correct a remaining mismatch only if reproduced. Exhausted malformed
citations create no task or question, consume the automatic revision durably,
reject unchanged replay after restart, and admit later genuine owner feedback
exactly once. Preserve retained evidence, digest integrity where review projections
are generated, and the separate dirty canonical-tree rejection behavior.

Run the citation suite, retained collector/integrity/handoff checks and the
appropriate runtime composition check if its owner changes. Explain whether the
repair corrects the fixture or production, with observed effects. Do not replace
this journey with a mock returning the expected watermark.

## Measurement And Provenance

Follow the measurement and family-level verification rules in
`task-assess-fifty-percent-reduction-after-citation-and-reminder-followups`.
This repair has no deletion quota. Report test/support/exclusion/production
deltas separately. Audit run `2026-09-12T22-32-50-597Z-builder-67j7si` retains
`citation-triage.log`, `citation-diagnostic.log`, the reversible diagnostic script,
and `selected-results.json`. The diagnostic changes were restored byte-for-byte.
This task is independent of retained live benchmark writers and host activation.

## Direct Judge Consumer

The same audit also reproduces a stale-contract candidate in
`src/modules/autonomy/shadow-semantic-review-runtime.test.ts`: the launch
assertion requires `persistSession: false`, but the current shared judge omits
that setting after runtime evidence retention. Reconcile this direct review
consumer in the same repair: verify the intended retained evidence/session
behavior and adapter propagation rather than restoring a flag solely to satisfy
an old literal. Preserve model, effort, autonomy and review-only authority.
The exact diff is in `assertion-triage.log`; do not assume omission proves the
correct persistence behavior without tracing the current harness contract.
