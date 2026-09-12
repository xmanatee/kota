---
status: open
priority: p1
---

# Restore readable systemic review and truthful citation follow-through

## Observed Product Gap

Progress-reviewer `2026-09-12T22-02-48-336Z-progress-reviewer-junxjt` reported
its full packet and recent artifacts inaccessible, then published no tasks,
handoffs, questions or resolutions. Its retained reference manifest has zero
entries. `workflow-steps.ts` writes the full packet under the canonical run while
passing compact references to the isolated reviewer. Reproduce that access path
on current main: `e94bfed2f` subsequently repaired cleanup retention, so do not
implement it again or assume every historical failure remains.

Use the existing runtime evidence handoff to expose selected same-scope outcomes,
interventions and counterevidence to the reviewer. Repair this consumer, not a
new store or another reviewer. Missing evidence must remain visibly unavailable,
not be reported as a clean no-action assessment. Preserve private originals and
deny unrelated scope access.

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

Own the reviewer consumption path and its citation-restart fixture. Preserve
clean-tree admission, evidence integrity and real consumption/publication.

## Outcome And Acceptance

An isolated reviewer can read its pinned packet and selected outcome evidence,
distinguish an ineffective intervention from task closure, and reject a hypothesis
using counterevidence. A concrete guidance defect can reach its implementation
owner through the existing handoff; scope-improver's deterministic skip does not
count as semantic review. No finding is required when evidence supports none.
No runtime packet is committed to source and replay creates no duplicate work.

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

Use `docs/VERIFICATION.md`; this repair has no deletion quota. The detailed
citation and assertion diagnostics remain in audit run
`2026-09-12T22-32-50-597Z-builder-67j7si`. Update existing consumer scenarios,
not an all-harness matrix. This task is independent of live benchmark writers.

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
