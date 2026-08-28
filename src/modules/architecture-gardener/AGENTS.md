# Architecture Gardener

Owns KOTA's continuous architectural simplification, architectural fitness
functions, AST-backed dependency and ownership observations, and generated
simplification work.

- Collect typed, deterministic architecture observations backed by TypeScript
  AST analysis rather than regular-expression source scans.
- Initial AST observations cover:
  - forbidden core-to-module dependencies
  - undeclared runtime cross-module imports
  - module dependency cycles
  - duplicate canonical ownership (tools, workflows, routes, commands, events)
- Suppress unchanged evidence through stable SHA-256 fingerprints,
  material-delta checks, and cooldowns.
- Admit semantic review only for an explicit owner request or convergent,
  materially changed signals (>= 2 independent eligible signals). A single
  file-size, churn, clone, or advisory metric must never create work by itself.
- Express each admitted opportunity as a falsifiable `SimplificationHypothesis`
  with a concrete behavior-preservation claim and a named structural
  improvement dimension.
- Prefer deletion, ownership collapse, and removal of obsolete paths.
- A new abstraction is justified only when it replaces at least two real
  maintained implementations or owners, names a stable variation axis, leaves
  consumers simpler, and has one canonical owner.
- Pareto comparator enforces:
  - improvement on the named structural dimension
  - preservation of declared behavior
  - zero regression on protected architectural invariants
  - retirement or bounding of the old path without permanent dual ownership
- Route implementation tasks through the shared `stageGeneratedWorkProposal`
  transaction. Create at most one normal implementation task per run.
- Permit automatic codemods only for narrow, idempotent TypeScript AST
  transformations whose pattern has already succeeded repeatedly under normal
  review and verification.
- Store durable observation state as a revisioned run-state projection in
  `RunStateDatabase`; retain detailed evidence in run artifacts. Do not create
  parallel JSON authority.
- Expose operator-readable status explaining evidence, disposition, and
  suppression through CLI, control routes, and UI contribution surfaces.
- Preserve `improver` as the owner of autonomy failures; architecture
  gardener is a distinct domain.
