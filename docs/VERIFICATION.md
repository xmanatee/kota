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
