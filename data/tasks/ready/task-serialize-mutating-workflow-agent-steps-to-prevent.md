---
id: task-serialize-mutating-workflow-agent-steps-to-prevent
title: Serialize mutating workflow agent steps to prevent concurrent-write writeScope blame
status: ready
priority: p1
area: runtime
summary: Two agent-step workflows ran concurrently despite agentConcurrency=1 default, causing a writeScope check to attribute one workflow's edits to another and failing the innocent run. Recurring class of bug: a prior instance was patched by dropping the builder no-intermediate-commits check. The underlying scheduler and attribution layers still allow concurrent mutating agent steps to collide.
created_at: 2026-04-24T14:50:39.184Z
updated_at: 2026-04-24T14:50:39.184Z
---

## Problem

The daemon is dispatching two different agent-step workflows concurrently even
though `scheduler.agentConcurrency` defaults to `1` and this repo has no
`.kota/config.json` override. When both concurrent steps mutate tracked files,
the post-step `writeScope` check in `src/core/workflow/steps/agent-write-scope.ts`
reads the whole-repo `git diff --name-only HEAD` and blames the finishing step
for every file the other concurrent step touched too.

Reproduced on 2026-04-24 between explorer run
`2026-04-24T14-04-37-931Z-explorer-5qwsga` (failed) and improver run
`2026-04-24T14-04-37-968Z-improver-ssbnin` (success). Both agent steps
started at `14:04:38.28x` (1 ms apart) and overlapped for the full 426 s of
the explorer's step. The explorer's tool-use events show it only Read
`src/modules/autonomy/AGENTS.md`; the improver's tool-use events show 11
`Edit` calls to the same file during that overlap. The explorer's
`steps/explore.write-scope-violation.json` lists `src/modules/autonomy/AGENTS.md`
as the violation, which is the file the improver wrote. The explorer's
proposed task-file never committed and the `ready/` queue emptied as a
result. Full evidence:
`.kota/runs/2026-04-24T14-04-37-931Z-explorer-5qwsga/steps/explore.write-scope-violation.json`,
`.kota/runs/2026-04-24T14-04-37-931Z-explorer-5qwsga/error.txt`,
`.kota/runs/2026-04-24T14-04-37-968Z-improver-ssbnin/steps/improve.events.jsonl`.

This is the same class of bug 98ef64ac (2026-04-22, "Drop builder
check-no-intermediate-commits racing concurrent workflows") already documented
for the builder↔research-retry overlap: concurrent workflow writes confuse a
post-hoc whole-repo check. That commit deleted the specific check but left the
concurrency + whole-repo-attribution substrate intact, so the next attribution
check (writeScope) now trips on it.

Either the scheduler is not enforcing `agentConcurrency = 1` across different
agent-step workflows, or the writeScope check needs to stop using whole-repo
state for per-step attribution — or both. The existing integration tests
cover `agentConcurrency=2` runs two different agent workflows simultaneously
(`src/workflow-runtime.integration.test.ts:1904`) and `agentConcurrency=1`
lets a code-only workflow run alongside an agent workflow
(`src/workflow-runtime.integration.test.ts:2167`), but do not cover the
specific case "`agentConcurrency=1` serializes two different agent-step
workflows queued close together."

## Desired Outcome

Concurrent mutating agent-step workflows can no longer contaminate each
other's writeScope attribution or commit staging. The regression is covered by
a test that reproduces the 14:04 shape: two different workflows, each with one
agent step, both enqueued within the same microtask tick, `agentConcurrency=1`,
and the runtime must serialize them so only one is inside its agent step at a
time. A complementary test asserts that when writeScope attribution runs, it
reflects only paths this step actually modified, not paths that a prior or
concurrent step wrote.

## Constraints

- Do not disable the writeScope check. It already caught real violations; the
  fix is making attribution accurate, not relaxing the gate.
- Do not introduce per-workflow worktrees or second runtime hosts — keep the
  single-daemon, single-worktree model described in `src/AGENTS.md` and
  `data/tasks/done/task-workflow-concurrent-execution.md`.
- Keep `agentConcurrency` / `codeConcurrency` / named `concurrencyGroup` as the
  public knobs; this task is about enforcing them, not redesigning them.
- The fix must work for the general case, not just the explorer↔improver pair.
  Builder↔research-retry already tripped the same substrate (see 98ef64ac);
  any heavy autonomy workflow pair can hit it.
- Do not add a dirty-worktree retry fallback that masks the bug at recovery
  time. The runtime already treats dirty completion as a recovery condition,
  and a concurrent-write collision must surface as a definite failure rather
  than a transient to retry.

## Done When

- A focused failing test in `src/workflow-runtime.integration.test.ts` (or a
  dedicated sibling) shows that with `agentConcurrency = 1` and two different
  workflows each having one agent step, only one agent step is active at a
  time, regardless of the inter-enqueue gap.
- A focused failing test for per-step writeScope attribution shows that a
  file mutated by a concurrent or prior step does not show up in this step's
  writeScope violations.
- Both tests pass after the fix. No workflow-agent step committed during or
  after the fix produces a `write-scope-violation.json` that references a path
  another concurrent workflow wrote.
- The builder, explorer, improver, decomposer, and inbox-sorter workflows all
  stay runnable without any per-workflow opt-out for the fix — no new
  `concurrencyGroup` declarations required on autonomy workflows for correct
  behavior.
- Root `AGENTS.md` guidance remains consistent with `data/tasks/done/
  task-workflow-concurrent-execution.md` (agent step serialized by default,
  code-only workflows still free to overlap). If any follow-on doc change is
  needed it lands in the same commit as the runtime fix.
