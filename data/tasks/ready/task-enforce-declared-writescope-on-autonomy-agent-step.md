---
id: task-enforce-declared-writescope-on-autonomy-agent-step
title: Enforce declared writeScope on autonomy agent steps
status: ready
priority: p2
area: guardrails
summary: Declare and enforce writeScope on autonomy agent definitions so the runtime blocks out-of-scope file mutations at the end of an agent step instead of relying on prompt guidance
created_at: 2026-04-19T13:15:58.071Z
updated_at: 2026-04-19T13:15:58.071Z
---

## Problem

`AgentDef.writeScope` exists as a typed field in `src/core/agents/agent-types.ts`
but it has no runtime behavior. Today the only place it is touched is
`src/modules/agent-ops/index.ts`, which prints it. None of the autonomy agents
(`builder`, `decomposer`, `explorer`, `improver`, `inbox-sorter`, `pr-reviewer`)
declare a `writeScope`, so the rule that "explorer writes only `data/tasks/`
and `data/watchlist.yaml`" lives only in prompts. An agent that ignores or
misreads the prompt can silently mutate any tracked file the step's
permission mode allows, and nothing inside the workflow runtime notices.

This will become a real safety gap as KOTA moves toward operating on external
projects and toward running multiple workflows in the same worktree: the
difference between "explorer touched `src/`" and "explorer refreshed the
queue" has to be legible to the runtime, not just to a reviewer reading the
diff after the fact.

## Desired Outcome

- Every autonomy agent that writes tracked files declares a typed `writeScope`
  that expresses the directories and files it is allowed to mutate, with a
  simple declarative format (path prefixes relative to `projectDir`).
- The workflow agent-step executor enforces that scope: at the end of an
  agent step, any tracked-file mutation outside the declared scope is a hard
  step failure, surfaced through the same channel as other step failures.
- The violation is captured structurally in the run artifact so operator
  clients can show "this step tried to write these out-of-scope paths" rather
  than only a log line.
- Workflows whose agent legitimately writes broadly (e.g. `builder`) declare
  that broad scope explicitly instead of relying on absence-means-unlimited.
- The "unrestricted" case still exists but is an explicit opt-in, not the
  default for unpopulated fields.

## Constraints

- Enforcement belongs in the workflow agent-step executor in
  `src/core/workflow/steps/`, not in each workflow definition. Do not add a
  per-workflow post-check that duplicates the same logic.
- Use real git status diffing (tracked files only) to compute the mutation
  set, not filesystem scans. Untracked scratch artifacts are already caught
  by the existing `no-scratch-artifacts` repair check.
- Do not add a new `writeScope` enforcement mode flag or test-only override.
  Failure is a step failure; recovery uses the existing dirty-worktree path.
- Keep the scope format declarative and typed (string[] of path prefixes).
  Do not introduce a new glob dialect, a DSL, or regex-based matching unless
  path prefixes prove insufficient for real scopes.
- Do not scope enforcement on `data/inbox/`, `.kota/`, or other per-run
  scratch surfaces — those are already gated by the `runDirPath` convention
  and the scratch-artifact check. Scope is about tracked-file writes.
- Declared scopes must be honest. Do not broaden a workflow's scope just to
  silence a violation; if the workflow legitimately needs to write elsewhere,
  that is a prompt/design problem, not a scope problem.
- Recovery-capable workflows that only run on `runtime.recovered` without
  reaching the agent step must not be penalized; the check only applies when
  the agent step actually ran.

## Done When

- `AgentDef.writeScope` is populated on every autonomy agent definition in
  `src/modules/autonomy/workflows/*/workflow.ts`, matching each agent's
  prompt scope.
- The core agent-step executor computes the tracked-file diff after the
  agent step and fails the step when any mutation falls outside the declared
  scope.
- A violation produces a typed artifact in the run output (step result) that
  lists the offending paths, and the existing per-step log shows the
  violation clearly.
- Tests in `src/core/workflow/steps/` cover: (1) in-scope writes pass,
  (2) out-of-scope writes fail the step with the offending paths reported,
  (3) unrestricted `writeScope: []` still works and is visibly intentional,
  (4) recovery-only entries skip the check when the agent step did not run.
- The `src/core/workflow/AGENTS.md` or `src/modules/autonomy/workflows/AGENTS.md`
  scope describes the model in one short section (declare → enforce → fail
  step), without listing per-workflow scopes in prose.
