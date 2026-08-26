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
updated_at: 2026-08-26T04:31:43.000Z
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
3. `task-security-review-calibration-freshness-now-checks-t`
4. `task-security-review-prepare-review-input-contains-proj`
5. `task-security-review-slack-approval-delivery-and-callba`
6. `task-security-review-the-completion-gate-authenticates`
7. `task-security-review-when-persistprofile-is-enabled-imp`
8. `task-complete-the-terminal-project-to-scope-migration`
9. `task-make-taskclaim-the-sole-active-work-authority`
10. `task-generate-all-thin-client-daemon-contract-bindings`
11. `task-make-capability-mechanisms-single-source-across-ko`
12. `task-unify-kota-product-identity-and-capability-languag`
13. `task-rewrite-mcp-client-orchestration-into-focused-prot`
14. `task-rewrite-module-manifests-into-focused-owned-projec`
15. `task-separate-task-queue-structure-from-autonomy-govern`
16. `task-rewrite-dead-letter-handling-into-focused-lifecycl`
17. `task-split-client-state-into-generated-transport-and-do`
18. `task-eliminate-workflow-test-shared-state-leakage`
19. `task-enforce-single-mechanism-architecture-boundaries`

The setup-metadata and Codex capability-truth prerequisites are complete. The
builder-recovery security proposal was dropped and is not an implementation
dependency. Queue paths and task frontmatter remain authoritative for the
nineteen open tracked tasks.

## Stage Progress

- [x] Stage 0 — establish the baseline and owner/rule ledger.
- [x] Stage 1 — remove misleading instructions and context bias.
- [x] Stage 2 — make builder validation and critic review proportional.
- [ ] Stage 3 — make exploration and health improvement outcome-driven.
- [ ] Stage 4 — reduce the task system to objective integrity.
- [ ] Stage 5 — separate shipping, validation, and confidence cadences.
- [ ] Stage 6 — complete the terminal project-to-scope migration.
- [ ] Stage 7 — establish one authored daemon/client contract graph.
- [ ] Stage 8 — narrow client ports and client-side owners.
- [ ] Stage 9 — make runtime lifecycle host-owned.
- [ ] Stage 10 — replace shadow runtimes with production drivers.
- [ ] Stage 11 — correct transport, capability, and mutation ports.
- [ ] Stage 12 — normalize persistence and typed projections.
- [ ] Stage 13 — decompose remaining mixed owners by responsibility.
- [ ] Stage 14 — consolidate tests and fixtures by behavior owner.
- [ ] Stage 15 — reconnect self-improvement to real feedback.
- [ ] Stage 16 — remove migration residue and verify the program.

Mark a stage complete only after its exit observation is true and its changes
are committed. A stage summary records the owner changed, the obsolete
mechanism removed, the proof selected, and the observed result in ordinary
prose; no additional evidence schema is required.

## Stage 1 Result

Central standards now distinguish authoritative contract mechanisms from the
tests that observe them. Scoped source, core, workflow, module, client, task,
server, autonomy, script, and test-infrastructure instructions no longer
prescribe copied catalogs, byte-identical fixtures, universal conformance arms,
parallel test interpreters, fixed evidence files, filename inventories, or
project-shaped extension paths.

The obsolete autonomy instruction catalog and its prose-synchronization test
were removed; the typed external-decision store is the sole catalog. Builder
now receives only its two role-local skills, and research retry receives no
unrelated skill bundle. Security proposals request the smallest proof that
distinguishes the vulnerable and fixed boundary instead of mandatory regression
coverage.

The stage removed a net 278 lines before this result record. Exit verification
observed no shipped autonomy workflow using `skills: "all"` and no scoped
instruction retaining the retired mandates. TypeScript, Biome on changed
sources, task validation, diff whitespace validation, the 21 security-review
workflow tests, and 18 documentation/external-decision/report tests passed.
The pre-change full-suite baseline remains independently red: 12,691 tests
passed and 25 skipped, while seven replay/eval smoke files failed because their
subprocess runs produced no terminal artifact.

## Stage 2 Result

Builder's universal repair catalog fell from twenty checks to two: the targeted
task must reach an honest terminal state, then the independent critic reviews
the result. Write scope, task digest, trust, secrets, process ownership, Git
publication, reconciliation, and integration safety remain enforced by their
runtime owners rather than repeated as builder checks. Post-reconcile validation
now runs task integrity instead of unconditional `pnpm check`; the builder
selects and runs behavior-specific proof from the final affected surface.

The builder prompt now treats scoped commands as suggestions and asks the
ordinary completion summary to name affected owners, selected validation or
non-test proof, its sufficiency, and limitations. The critic receives that
summary and available operator evidence as context. Its shortened criteria
judge fulfillment, observable behavior, ownership, safety, honesty, and proof
sufficiency without task-class, keyword, artifact-shape, test-presence, or
file-line-citation pre-rejection. A clean pass stays a clean pass, and a warning
may be accepted as non-actionable with a reason rather than forcing a task.

Nine builder-only proxy/check files and their fixture tests were removed. The
stage deleted a net 1,408 lines. Inspection of server, client/Product, and
documentation/generated-contract proof paths showed the same two authority
checks with no platform command matrix; critic scenarios accept a generated
contract proof or no operator artifact when the actual outcome makes that
sufficient. TypeScript, Biome on changed sources, task validation, diff
whitespace validation, and 28 focused critic, builder, and real blocking-worker
tests passed.

## Finding Ownership

| Finding | Stage | Canonical owner | Mechanism retired |
| --- | ---: | --- | --- |
| P0-A instructions create test obligations | 1 | central standards plus local ownership docs | fixture, harness, test, and evidence prescriptions |
| P0-B copied client contracts | 7 | daemon contract graph and generator | handwritten language mirrors and giant structural fixture |
| P0-C workflow test interpreter | 10 | production run host | test-owned step execution |
| P0-D global mutable lifecycle | 9 | disposable host lifecycle scope | reset catalogs and ambient registries |
| P0-E global HTTP emulator | 10 | production dispatch plus real Node networking | global fetch and Node protocol patching |
| P0-F autonomy proxy compliance | 2–4, 15 | builder, critic, health, and task owners | name, keyword, size, quota, and artifact quality proxies |
| P1-A project/scope dual API | 6 | scope protocol and one external adapter | internal compatibility aliases and precedence |
| P1-B premature remote mutation success | 11 | remote task-provider port | synchronous success before durability |
| P1-C shipping/test build mixture | 5 | TypeScript and validation projects | tests/support in production build |
| P1-D raw outbound HTTP baseline | 11 | outbound HTTP transport and linter | source-parser exception baseline |
| P1-E broad manifest/context ownership | 13 | canonical manifest with focused responsibilities | broad activation/inspection context |
| P1-F replacement proof stack | 4 | normal task/run provenance and changed owner | assertion coverage and source binding |
| P1-G task validator policy mixture | 4 | objective task-integrity validator | prose, priority, evidence, and architecture gates |
| P1-H aggregate client fixture fan-out | 8 | narrow generated/domain ports | whole-client stubs and unsafe casts |
| P1-I boolean/no-op capabilities | 11 | declared capability ports | required optional methods and successful no-ops |
| P1-J aggregate client state/SSE | 8 | focused domain state and one event transport | parallel stream parsers and coordinators |
| P2-A unchecked persistence reads | 12 | module-owned decoder and migration | unchecked parsed durable objects |
| P2-B memory vertical | 12 | memory owner using shared mechanisms | memory-specific parallel architecture |
| P2-C duplicate working-memory tests | 14 | working-memory behavior owner | repeated store semantics |
| P2-D mixed MCP tests | 13–14 | focused MCP protocol owners | giant mixed suites and fixtures |
| P2-E mixed dead-letter lifecycle | 13 | one dead-letter lifecycle facade | mixed capture/store/redrive/presentation owner |
| P2-F static guard tests | 14, 16 | compiler, schema, generator, or linter owner | migration scans and baselines |
| P2-G scoped documentation drift | 1, 16 | nearest stable ownership docs | inventories and volatile mechanics |
| P2-H generic evidence casts | 12 | typed/generated public projections | stronger DTO casts after generic redaction |

## Rule Disposition Ledger

| Rule family | Disposition | Owning stage |
| --- | --- | ---: |
| write/path containment, task/run identity and digest, secrets/trust, publication/idempotency, protocol decoding, native dependency allowlist | keep strict as deterministic authority or safety | 2–5 |
| import boundaries, raw HTTP ownership, generated-contract freshness, typed registry pairing | replace source scans with compiler, schema, generator, or linter ownership | 5, 7, 11 |
| validation sufficiency, proof choice, file cohesion, task value/priority, rendered evidence relevance, follow-up value | make advisory context for builder/critic/reviewer judgment | 1–4 |
| project aliases, raw-fetch baseline, retired-entrypoint search, temporary dual reads | keep only for migration with deletion at terminal cutover | 6, 11, 16 |
| step/check-name quality audit, strategic-ready quotas, acceptance-evidence keyword scans, source-size blockers, observability token scans, prose/catalog synchronization | delete after confirming no authority boundary | 1–4 |

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
