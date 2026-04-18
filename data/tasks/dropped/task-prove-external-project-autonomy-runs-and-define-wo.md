---
id: task-prove-external-project-autonomy-runs-and-define-wo
title: Prove external-project autonomy runs and define workflow-contribution precedence
status: dropped
priority: p2
area: architecture
summary: Add an end-to-end test that boots the daemon against a fixture project distinct from KOTA's own tree and completes a trivial workflow step there, and define and enforce the precedence between module-shipped and project-local workflow contributions
created_at: 2026-04-18T04:01:44.972Z
updated_at: 2026-04-18T15:49:10.198Z
---

## Problem

The just-completed external-project task landed the core pieces —
`DaemonConfig.projectDir`, `resolveProjectDir()`, per-module install
root for workflow prompts — but explicitly leaves two follow-ups
unresolved in its `## Remaining Architectural Work` section:

1. There is no end-to-end test that boots the daemon against a target
   project outside KOTA's own source tree and proves a workflow step
   actually runs there. Every existing integration test runs against
   KOTA's own repo.
2. Precedence between module-shipped workflow prompts and workflows a
   target project might ship in its own tree is undefined. The
   loader resolves `promptPath` against the module install root; a
   target project shipping its own workflow has no documented rule for
   how its prompt path is resolved, whether it can override a
   module-shipped workflow name, or what happens on name collision.

Without either piece, the claim "KOTA can operate on external
projects" is a one-directional proof: KOTA can run *its own* workflows
against a foreign `projectDir`, but a target project cannot
contribute workflows, and no test exercises the foreign-project path.

## Desired Outcome

- An integration test boots the daemon with a `projectDir` that is a
  disposable fixture directory distinct from KOTA's own source, with
  its own minimal `data/tasks/` or trigger state, and runs at least
  one autonomy workflow step (for example a trivial
  builder-compatible no-op workflow) to completion. The test asserts
  that reads and writes land inside the fixture directory, not the
  KOTA tree.
- The workflow loader has a documented, enforced precedence when the
  target project contributes its own workflows: whether project-local
  workflows may override module-shipped workflows by name, how
  collisions are reported, and where project-local prompt paths
  resolve.
- A second integration test covers a project-local workflow
  contribution and a collision with a module-shipped workflow, and
  asserts the documented precedence.

## Constraints

- Reuse the existing daemon and workflow runtime startup paths. Do not
  add a parallel "external project" entrypoint.
- The fixture project should not be checked into `src/`. Build it in
  `os.tmpdir()` (or a test-scoped directory) and clean up on teardown.
- Do not weaken the module install-root resolution for shipped
  prompts. Project-local workflows resolve their prompts against
  `projectDir`; module-shipped workflows continue to resolve against
  the module's own install root.
- If the resolved precedence forbids project-local override of
  module-shipped workflow names, the loader fails loudly at load time
  rather than silently picking one.
- Keep the documented precedence short and live in the existing
  workflow and module `AGENTS.md` surfaces — do not spawn a new
  top-level external-project doc.

## Done When

- A new integration test (not inside KOTA's own repo tree as the
  target) boots the daemon against a temp fixture `projectDir` and
  runs a workflow step to completion, asserting file activity stays
  inside the fixture.
- The workflow loader applies a documented precedence rule for
  project-local vs module-shipped workflow contributions, covered by
  a second integration test that exercises both a non-colliding
  project-local workflow and a colliding name.
- The precedence rule is described in the relevant `AGENTS.md`
  (`src/core/workflow` or `src/modules/AGENTS.md` — whichever owns
  the loader) in one short paragraph.
- The remaining-architectural-work note in the done
  external-projects task is either unnecessary because this task
  covered it, or a short follow-up referencing the closed gap.

## Decomposed

Builder run `2026-04-18T15-10-49-121Z-builder-jzr6ol` timed out at the
35-minute step deadline on this task. The two `## Problem` follow-ups are
independent enough to land separately; the precedence work depends on the
foreign-project pathway being exercisable end-to-end. Split into:

- `task-prove-external-project-autonomy-with-end-to-end-fi` — foreign
  `projectDir` integration test that proves a workflow step runs against a
  fixture project distinct from the KOTA tree.
- `task-define-project-local-vs-module-shipped-workflow-pr` — define and
  enforce the precedence rule between module-shipped and project-local
  workflow contributions, with non-colliding and colliding-name
  integration tests.
