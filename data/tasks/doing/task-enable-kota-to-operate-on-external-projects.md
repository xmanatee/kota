---
id: task-enable-kota-to-operate-on-external-projects
title: Enable KOTA to operate on external projects
status: doing
priority: p2
area: architecture
summary: Refactor KOTA to support running autonomous workflows on projects beyond its own repo, requiring better encapsulation and abstraction of project-specific concerns
created_at: 2026-04-15T21:22:29.867Z
updated_at: 2026-04-18T00:24:10.412Z
---

## Problem

KOTA currently only develops and improves itself. The owner wants to run KOTA's autonomous workflows (inbox sorting, task execution, exploration, improvement) on other projects — creating inbox tasks for a project and having the daemon pick them up automatically. This requires separating KOTA-specific concerns from general autonomous development capabilities.

## Desired Outcome

- KOTA can be pointed at an external project and run autonomous workflows against it.
- Project-specific context (AGENTS.md, data/, docs/) is discovered from the target project, not hardcoded to KOTA's own repo.
- The daemon can manage workflows across multiple project roots.
- Shared logic (workflow runtime, agent loop, tool protocols) is cleanly separated from KOTA-specific configuration.

## Constraints

- Requires careful architecture assessment before implementation — this is a significant refactoring.
- Must not degrade KOTA's own self-development workflow during the transition.
- Encapsulation and abstraction boundaries need design review, not just mechanical extraction.

## Done When

- KOTA can run at least one autonomous workflow (e.g. inbox-sorter, builder) against a separate project repo.
- Project-specific context is read from the target project, not KOTA's own tree.
- KOTA's self-development workflows continue to work unchanged.

## Progress

- The daemon already takes `projectDir` through `DaemonConfig`. The workflow
  runtime, repo-task snapshot, run store, and agent step `cwd` all respect
  the same value, and project module discovery walks KOTA's own install
  tree via `import.meta.url` independently of `projectDir`.
- Operator surfaces now resolve the project root through a single
  `resolveProjectDir()` helper (`src/core/config/project-dir.ts`) that honors
  the `KOTA_PROJECT_DIR` env var and a new `kota daemon --project-dir <path>`
  flag, and daemon-ops, module-manager, doctor, qr-cli, status-cli, and the
  daemon control client all look up the state dir through the same helper.

## Remaining Architectural Work

The blocking gap for a real external-project run is that
`WorkflowAgentStep.promptPath` is resolved against `projectDir`
(`src/core/workflow/steps/step-executor-agent.ts`). Ship-with-KOTA workflow
prompts therefore cannot be found when the daemon is pointed at a target
project that does not contain KOTA's own source tree. A coherent fix needs
to:

1. Carry the module's own install root alongside each contributed workflow
   definition (the loader knows it; the step executor does not).
2. Resolve `promptPath` against that module root rather than `projectDir`,
   and thread the same root through the `Prompt file: …` line emitted in
   `buildAgentPrompt`.
3. Decide whether project-local workflow contributions (a future target
   project shipping its own workflows) resolve `promptPath` against
   `projectDir` instead; define the precedence and validate it.
4. Add an end-to-end test that boots the daemon against a fixture project
   directory distinct from KOTA's own source and verifies at least one
   autonomous workflow completes a trivial step.
