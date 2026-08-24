---
id: task-converge-kota-on-a-clean-single-mechanism-architec
title: Converge KOTA on a clean single-mechanism architecture
status: backlog
priority: p1
area: architecture
task_class: Platform
anchor: true
summary: Track the approved terminal migrations, trust-boundary repairs, operator fixes, contract generation, targeted rewrites, and enforcement needed to leave one clean mechanism per job.
created_at: 2026-08-24T02:13:36.188Z
updated_at: 2026-08-24T02:13:36.188Z
---

## Problem

KOTA has strong canonical primitives, but approved audit findings show that
KOTA-owned compatibility paths, duplicate client contracts, mixed-responsibility
subsystems, and misleading operator surfaces still remain. Treating each as an
isolated patch would preserve the seams that created the findings.

## Desired Outcome

Complete the approved initiative as terminal migrations. Every sub-slice moves
all production callers, clients, schemas, state, tests, fixtures, and docs to
one owner; removes the superseded path in the same initiative; and adds a
deterministic boundary check that prevents it from returning.

Tracked implementation tasks:

1. `task-protect-workflow-authority-provenance-from-agent-w`
2. `task-security-review-a-task-authored-artifact-can-decla`
3. `task-security-review-builder-recovery-now-treats-retryo`
4. `task-security-review-calibration-freshness-now-checks-t`
5. `task-security-review-prepare-review-input-contains-proj`
6. `task-security-review-slack-approval-delivery-and-callba`
7. `task-security-review-the-completion-gate-authenticates`
8. `task-security-review-when-persistprofile-is-enabled-imp`
9. `task-complete-the-terminal-project-to-scope-migration`
10. `task-make-taskclaim-the-sole-active-work-authority`
11. `task-render-setup-metadata-without-redacting-operator-c`
12. `task-report-and-validate-codex-harness-capabilities-tru`
13. `task-generate-all-thin-client-daemon-contract-bindings`
14. `task-make-capability-mechanisms-single-source-across-ko`
15. `task-unify-kota-product-identity-and-capability-languag`
16. `task-rewrite-mcp-client-orchestration-into-focused-prot`
17. `task-rewrite-module-manifests-into-focused-owned-projec`
18. `task-separate-task-queue-structure-from-autonomy-govern`
19. `task-rewrite-dead-letter-handling-into-focused-lifecycl`
20. `task-split-client-state-into-generated-transport-and-do`
21. `task-eliminate-workflow-test-shared-state-leakage`
22. `task-enforce-single-mechanism-architecture-boundaries`

## Constraints

- This is a strategic anchor. Automations implement the normalized sub-slice
  tasks, never this file as one broad rewrite.
- KOTA-owned legacy paths, aliases, compatibility readers, fallback routes,
  copied schemas, and exception allowlists are not an acceptable terminal
  state.
- External protocol or vendor concepts may retain their own terminology only
  inside the owning adapter and only for an explicitly supported version.
- Prefer cohesive replacement over small diffs. Characterize behavior first,
  cut every caller over, then delete the old implementation before completion.
- Do not split files mechanically; rewrite where ownership cannot otherwise be
  made clear and preserve behavior through production and recovery ingress.

## Done When

- Every tracked implementation task is done with its acceptance evidence.
- The terminal project-to-scope migration, canonical onboarding/setup work,
  truthful Codex capability reporting, and TaskClaim state convergence are
  done.
- All thin-client bindings are generated from one contract and the core client
  module-import exception is gone.
- Product identity is consistent across metadata, prompts, CLI, and clients.
- MCP orchestration, module manifests, task validation, dead-letter handling,
  and client state have focused owners without parallel implementations.
- Workflow test isolation is stable under full-suite and randomized execution.
- The single-mechanism architecture gate passes without compatibility or
  exception allowlists.

## Source / Intent

Owner approval on 2026-08-24 after a fresh repository, runtime, queue, and test
audit. The owner explicitly requires full migrations with no leftovers,
redundancy, or KOTA-owned legacy behavior and accepts targeted rewrites when
that is the cleanest route.

## Initiative

Clean, production-proven single-mechanism KOTA architecture.

## Acceptance Evidence

- Generated initiative report mapping every approved finding to a completed
  task, canonical owner, and retired-path proof.
- `pnpm typecheck`, `pnpm lint`, `pnpm hygiene`, `pnpm validate-tasks`, full
  tests, client builds/tests, and the architecture fitness check all pass.
- Structural search report contains no KOTA-owned compatibility path,
  duplicate contract, legacy allowlist, or superseded registration surface.
