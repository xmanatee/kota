# Standards

## Sources of Truth

- `docs/` holds durable cross-cutting conventions. Scoped `AGENTS.md` files
  specialize ownership and decisions without repeating inherited guidance.
- `data/inbox/` holds rough captures. `data/tasks/` holds active outcome contracts;
  terminal tasks live in `data/tasks/archive/`. Task status is `open` or `blocked`;
  runtime ownership supplies the transient in-progress state.
- Git history, terminal task records and `.kota/runs/` hold historical evidence.
  Operational state belongs under `.kota/`; do not add parallel runtime, audit,
  changelog, lesson or backlog surfaces.
- Keep documentation current, concise and close to its owner. Explain decisions
  that code cannot communicate; omit function inventories, schema copies,
  migration notes and repeated implementation details. Prune obsolete guidance
  with the behavior it described.
- Prompts describe role and task intent. Durable conventions belong here or in
  scoped guidance; runtime mechanisms belong in typed contracts and code.
- Separate tutorials, how-to guidance, reference and explanation. Use typed
  schemas and links rather than copied catalogs. Distill research into decisions.

## Architecture and Workflow Ownership

[Architecture](ARCHITECTURE.md) owns the runtime lifecycle, publication and
recovery contracts. Workflows declare semantic work through those shared owners.

- Trace maintained consumers before choosing a design. Share actual common
  behavior, preserve necessary variation, migrate callers and remove replaced
  paths and redundant proofs together. Patch size is secondary to clarity.
  Keep single-use logic local. Leaving code unchanged is valid when it serves the goal.
- Types, classes and protocols express contracts, not an OOP/SOLID checklist.
  A new design does not require an additional planning agent or workflow.
- Core owns neutral runtime contracts; modules own swappable capabilities and
  vendor adapters. Package imports (`#core/*`, `#modules/*`, `#root/*`) cross trees;
  relative imports serve local siblings. Use the existing source/build resolution.
- Author repository content with normal editors. Task/inbox APIs are convenience
  adapters. Validate the complete changeset before publication, not intermediate
  keystrokes. Runtime claims, approvals and external effects remain controlled.

## Engineering and Review Decisions

- Validate untrusted values at their owner boundary and use precise types inside.
  Distinct states use discriminated unions and exhaustive handling. Absence,
  normalization and fallback require explicit domain meaning; malformed internal
  protocols fail visibly. Do not hide legitimate zero, false or empty values.
- Encode stable invariants in types, schemas, decoders, generators, registries,
  package boundaries or runtime policy. Tests exercise those mechanisms; tests
  do not make an implementation conform. Prefer naturally testable interfaces
  over test-only production flags, branches or hooks.
- Review fulfillment, ownership/maintainability, safety/honesty and proof
  sufficiency. Block concrete unmet outcomes, incorrect or unsafe behavior,
  duplicated authority, unmigrated consumers, dishonest claims or insufficient
  proof. Formatting belongs to tooling; optional improvements and equally valid
  designs do not block acceptance. Clean approval needs no invented warning.
- A task describes a coherent consumer outcome and observable acceptance.
  Builders discover implementation steps. A failed run warrants diagnosis;
  decomposition needs useful conceptual seams and must preserve owner intent.
- Keep work open while implementation, environment setup or alternative scoped
  validation can advance it. Block only on a specific prerequisite outside the
  available authority, such as an unavailable credential or an owner decision.
  Runtime-owned publication and subsequent deployment observation follow the
  builder step; they cannot be prerequisites for finishing that same step.
  Report unperformed checks honestly and use proportionate available proof.
  Post-deployment monitoring must not gate independent work whose code prerequisite
  has already integrated. Proven functional or security defects still require repair.
- Prefer owner-visible product outcomes to internal meta-work. Fix confusing
  client, CLI, setup, approval or blocked-work journeys before adding mechanisms,
  unless safety or a runtime-stopping failure takes precedence. Inspect the real
  operator journey through a transcript, screenshot, runtime probe or equivalent
  evidence; unit tests alone cannot establish product acceptance.
- Improve wasteful ownership, admission and repair behavior before adding hard
  daily spend caps. Do not optimize healthy mechanisms at the expense of clarity,
  capability or quality. Runtime, workflow and core-loop changes warrant broader
  failure and recovery verification than routine edits.
- Use pnpm. Dependency-install safeguards belong in pnpm-workspace.yaml with
  narrow, justified exceptions.

## Verification

Select proof by the changed behavior and owner. Each retained mechanism has a
consumer, production owner, public stimulus, observable oracle, distinct failure
it detects and execution cadence. These are engineering questions, not mandatory
per-change paperwork, source keywords, artifact shapes or test quotas.

- Use types for internal structure, decoders for boundary rejection, generators
  for binding consistency and registries for single registration ownership.
  Biome enforces declared dependency restrictions; lint and typechecking do not
  prove the entire dependency graph acyclic. Omit new tests when an authoritative
  mechanism already establishes the behavior.
- Give behavior one owning test layer: a focused test for a pure decision, a
  component test for a real persistence/process boundary, and a small integration
  journey for a consequential interaction between owners. New integration cases
  identify their distinct failure and retire the replaced scenarios together.
- Assert public outcomes, not private phases, source spelling, constructors,
  filenames or configuration catalogs. Configuration tests exercise rejection,
  precedence, propagation and effects. Generated projections may be compared
  directly with their canonical source. Source scans are reserved for security
  boundaries that types, visibility or runtime behavior cannot express.
- Fixtures are representative inputs, recordings or semantic examples. Doubles
  may replace external ports such as clocks, networks and subprocess launchers;
  they must not reimplement workflow, lifecycle, storage or transport semantics.
  Shared contract suites apply only to implementations declaring that capability.
  Keep implementation-specific behavior with its owner and exercise generic
  retry/capacity decisions over representative values rather than every setting.
- Live evaluations measure model-dependent outcomes with calibrated scorers.
  Select them deliberately for model/prompt decisions. Deterministic harness
  behavior belongs to owner verification; fixtures do not prescribe one valid
  implementation, reasoning trace or test name.

The configured portfolios in `vitest.config.ts` have explicit, non-overlapping
membership. `pnpm check:fast` is the deterministic static gate. Select affected
owner, protocol, resilience, integration or CLI tests for behavioral feedback.
`pnpm test:eval` runs live evaluations; `pnpm test:preset-parity` runs the live composed daemon parity journey. `pnpm check` adds the production
build and all deterministic partitions for broad/high-risk or release confidence;
ordinary tests and checks exclude live model evaluation.

Build and test native clients when their source or shared contracts change.
Changed-file selection needs judgment about schema, configuration and transitive
runtime effects. Keep security and restart scenarios with their owning portfolio.

[VERIFICATION_BASELINE.md](VERIFICATION_BASELINE.md) retains the bounded reduction
migration's frozen evidence. It does not define steady-state policy or require
future changes to meet a LOC-reduction target.

## Scoped Guidance

Add local AGENTS guidance only where ownership, authority or recurring decisions
differ from the parent. Delete repetition and discoverable facts. Split only for distinct ownership.
Explain recurring defaults and their reasons. Name the canonical alternative
when prohibiting a pattern.
