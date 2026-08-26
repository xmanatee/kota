# Tasks

This directory is the normalized live work queue after ideas leave
`data/inbox/`. State directories define their lifecycle boundaries; read the
nearest `AGENTS.md` before changing a task.

## Task contract

- Use the task command to create and move tasks. The repo-tasks domain owns
  identifiers, safe paths, lifecycle states, dependencies, and mutation
  authorization.
- Tasks usually state `Problem`, `Desired Outcome`, `Constraints`, and `How We
  Will Know`. These are authoring prompts, not validator-required keywords;
  natural prose is valid when it preserves the same intent. Builders own the
  implementation plan.
- Preserve owner wording, observed runtime evidence, research provenance, and
  urgency. Do not normalize away why the task exists.
- Represent hard predecessors with `depends_on`; do not duplicate ordering in
  prose or add transitive edges.
- Choose the strongest proportionate observation for the outcome. A live
  journey may be useful for operator-facing work and a focused behavior check
  may be sufficient for an internal change, but task labels never prescribe a
  fixed artifact, filename, or test category.
- Task metadata helps routing and prioritization. It must not turn preferences,
  reviewer judgment, or implementation details into mechanical completion
  gates.

The scaffold and validator remain the machine-readable format authority. Do
not copy their field catalogs or accepted-value lists into instructions.

## Strategic anchors

An anchor tracks a multi-stage initiative whose outcome is achieved by its
owned slices. Keep it in backlog as a progress and decision record; do not
dispatch it as a builder-sized task. Update stage state and ownership as work
lands, and remove obsolete tracked slices rather than preserving a historical
inventory.

## Queue policy

- New rough ideas belong in `data/inbox/`.
- Prefer coherent product or architecture outcomes over split, rename, dedup,
  move, import, test-only, evaluator-only, or artifact-only work.
- Before creating work, inspect the queue for an existing owner and merge
  overlapping intent.
- Owner-visible regressions, safety risks, broken runtime behavior, and stale
  owner requests outrank self-referential process optimization.
- Keep state honest. Move completed, superseded, or no-longer-useful work
  instead of retaining it to satisfy a metric.
- Before finishing a queue mutation, run task validation for identity, path,
  dependency, and lifecycle integrity.

## Blocked work

Blocked tasks name one concrete external precondition that can be evaluated
without reinterpreting the whole task: completion of a prerequisite, local
capability availability, an owner decision, or an operator-only action. The
state owner defines the typed representation.

Do not use `blocked/` as a parking lot or treat an agent sandbox limitation as
an operator dependency when the trusted runtime can perform the action. Revisit
stale blockers, update the owner-facing request when needed, and drop or
rescope work whose outcome no longer matters.
