---
id: task-define-project-local-vs-module-shipped-workflow-pr
title: Define project-local vs module-shipped workflow precedence and cover with tests
status: ready
priority: p2
area: architecture
summary: Define and enforce a documented precedence between module-shipped workflow prompts and workflows a target project ships in its own tree, and cover both non-colliding contribution and name-collision cases with integration tests
created_at: 2026-04-18T15:48:07.698Z
updated_at: 2026-04-18T15:48:07.698Z
---

## Problem

The workflow loader resolves `promptPath` against the module install root,
but a target project that wants to ship its own workflows in its own tree
has no documented rule for how its prompt path is resolved, whether it can
override a module-shipped workflow name, or what should happen on a name
collision. Today this is undefined behavior — a target project cannot
contribute workflows in a predictable way.

## Desired Outcome

- A documented, enforced precedence rule between module-shipped and
  project-local workflow contributions, covering: where project-local
  prompt paths resolve (against `projectDir`), whether project-local
  workflows may override module-shipped workflow names, and how
  collisions are reported.
- The workflow loader enforces that rule. If precedence forbids
  project-local override of module-shipped workflow names, the loader
  fails loudly at load time rather than silently picking one. If override
  is allowed, the loader applies the documented rule deterministically.
- The precedence rule is described in the relevant `AGENTS.md`
  (`src/core/workflow` or `src/modules/AGENTS.md` — whichever owns the
  loader) in one short paragraph.

## Constraints

- Do not weaken the module install-root resolution for shipped prompts.
  Module-shipped workflows continue to resolve against the module's own
  install root.
- Do not introduce a parallel project-local workflow registry or loader
  path. The same loader handles both sources, with one decision point for
  precedence.
- Keep the documented precedence short and live in existing workflow and
  module `AGENTS.md` surfaces — do not spawn a new top-level
  external-project doc.
- Depends on the foreign-project E2E pathway being exercisable; coordinate
  with `task-prove-external-project-autonomy-with-end-to-end-fi` so the
  precedence test reuses the same fixture-project mechanism.

## Done When

- The workflow loader applies a documented precedence rule for
  project-local vs module-shipped workflow contributions.
- An integration test exercises a non-colliding project-local workflow
  contribution and asserts it loads and runs.
- A second integration test exercises a name collision between a
  project-local and a module-shipped workflow and asserts the documented
  precedence behavior (loud failure or deterministic override).
- The precedence rule is documented in the relevant `AGENTS.md` in one
  short paragraph; no new top-level doc.
- The remaining-architectural-work note in the previously completed
  external-projects task is either unnecessary because this task and its
  sibling covered both follow-ups, or replaced with a short closed-gap
  reference.
