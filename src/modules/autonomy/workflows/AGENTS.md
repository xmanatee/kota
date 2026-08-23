# Workflows

Autonomy workflows and their co-located prompts live here.

- Each workflow should live in its own subdirectory with code plus markdown prompt assets.
- Keep workflows cohesive, typed, and role-focused; keep durable guidance in markdown.
- Keep prompts short. Durable policy belongs here or nearby docs, not repeated
  in every `prompt.md`; operator-facing digest bodies stay out of agent prompts.
- `workflow.ts` is the source of truth; default-export the definition and any named agent.
- The autonomy module discovers this directory; do not add another registry.

## Finish Protocol

When a workflow agent finishes its work:

- Write a short message to `<run-directory>/commit-message.txt`. Do not run
  `git add` or `git commit`; the workflow stages after each agent response and
  commits after validation.
- The agent-facing run directory is isolated `agent-output/` (or a runtime
  resource override such as builder evidence), separate from metadata and step
  state. Consumers resolve the same path.

Prompts should not repeat these instructions. Workflow-specific finish guidance
(e.g. validation before stopping) stays in the prompt.

## Self-Trigger Loop Risk

Any workflow with a `workflow.completed` trigger must narrow that trigger so it
cannot match its own completion payload. A self-matching completion trigger
creates an infinite loop that hangs the runtime and the test suite. The
validation layer enforces this at definition load time as a hard error.

## Runtime Rails

Timeouts, trigger validation, dirty recovery, commit prevention, and repair
checks are runtime rails, not prompt policy. Keep code typed and prompts role-
focused. Commit prevention lives at the SDK `canUseTool` boundary. Its guards
use bare `deny`; `interrupt: true` aborts the session and discards progress.
Synchronous Git commit preflight, terminal commit, and recovery reset helpers
run through definition-owned blocking operations; workflow steps and repair
checks must not invoke those helpers directly on the daemon event loop.

Every workflow that calls `commitWorkflowChanges` must also wire
`checkCommitStageable` into its repair loop. The terminal commit step's
`git add -A -- <paths>` is unrecoverable; the repair-loop dry-run catches
ignore conflicts (e.g. a nested `.gitignore` re-ignoring a path the repo-
root rules un-ignored) before an agent run dies at staging.

`commitWorkflowChanges` is also the source of truth for restart necessity.
Commits confined to `data/tasks/` are live queue-state changes and must not
restart the daemon; restart predicates consume the commit outcome instead of
reclassifying paths in individual workflows.

### Autonomy Mode Declaration

Every agent step declares autonomy explicitly; prefer workflow-level
`defaultAutonomyMode`. Native harnesses cannot honor named tool restrictions,
so validation rejects them for every write scope. Passive mode is read-only;
KOTA-controlled loops also receive workflow nesting, commit, and teardown guards.

### Agent-Step Retry and Error Classification

See `src/core/workflow/steps/AGENTS.md` (`DEFAULT_AGENT_STEP_RETRY`, signal
table, per-step overrides) and `src/modules/autonomy/AGENTS.md` (judge-
wrapper contract for repair checks invoking `invokeAgentJudge`).

## Unit Testing

Each workflow with non-trivial `when` predicate or skip/run logic should have a
co-located `workflow.test.ts` covering those decisions — not agent step
content. Workflows without such logic rely on the integration test below.

## Routing

Only the `dispatcher` workflow listens to `runtime.idle`. Other autonomy
workflows should trigger on semantic bus events that describe repo state, not
on a fixed workflow graph.

Never add `runtime.idle` as a trigger to a non-dispatcher workflow. If a new
workflow needs periodic polling, add the condition check to the dispatcher and
emit a clearer event.

Prefer explicit bus events over workflow-name inventories or secondary routing metadata.

- If one workflow should wake another, emit a named event that describes the handoff.
- Keep the event semantic: describe what became true, not which workflow just ran.
- Use `workflow.completed` only when the consumer truly cares about generic run
  completion rather than a more specific domain event.
- Queue-shaping events should describe repo state directly instead of
  overloading generic events or teaching consumers to infer state from
  unrelated workflow names.

### Queue-shape events

Dispatcher emits queue-shape events distinguishing actionable from backlog-only state:

- `autonomy.queue.available` — actionable (`ready` + `doing`) exists; builder gates on this.
- `autonomy.builder.recovery.requested` — resume preserved builder work before unrelated work.
- `autonomy.queue.needs-promotion` — actionable=0 and at least one non-anchor,
  dependency-clear backlog task can legally enter `ready/`; `backlog-promoter`
  consumes this and writes a deterministic promotion rationale before builder
  resumes. Strategic anchors and ready-invalid tasks do not count as promotable
  work.
- `autonomy.queue.empty` — no dispatchable task work and no known dependency
  or claim blocker exists. Explorer may use this state to find new work.
- `autonomy.queue.thin` — one or two dispatchable ready/promotable backlog
  tasks remain, or only active doing work remains; strategic anchors, ready-
  invalid backlog, and dependency-waiting tails stay visible through counts and
  `dependencyBlockedTasks` without counting as thin.
- `autonomy.blocked-research.attemptable` — blocked research can retry; `research-retry` consumes this instead of `autonomy.queue.available`.

Builder must never silently consume the backlog — the rationale is the
operator-auditable record of why the next ready batch is the right one.

## Repair-Loop Checks

Repair-loop checks validate without editing or staging; agents own repairs.
Use `type: "code"`; shell is module-owned and may be absent. Keep hygiene
checks objective. Architecture and intent-heavy cleanup stay with agent
judgment. Keep route/event/config catalogs in source types and focused tests.

## Dirty Failure Recovery

If a workflow fails dirty, the runtime treats it as recovery rather than queue
progress: restart once, queue `runtime.recovered` consumers, then pause if the
same dirt remains. Do not reintroduce dirty-worktree bounce loops.

Canonical task writers use the repo-tasks domain mutation API, which stages
each exact task/inbox path as part of the operation. Canonical tracked mutators
share the workspace-policy concurrency group. A workflow must not bypass
either contract with direct task writes or a private staging helper.

## Recovery Contract
Every autonomy workflow whose steps can mutate tracked files opts into
recovery by:

1. Setting `recoveryCapable: true` in its definition.
2. Adding a `runtime.recovered` trigger (the runtime filters recovery dispatch
   to recovery-capable workflows only; the validation layer rejects mismatches).
3. Running a reset step first to restore a safe base before heavier work. Use
   `resetWorktreeForRecovery` from `#modules/autonomy/recovery.js`; it stashes
   tracked and untracked dirt and can switch from a `kota/task/*` branch to the
   base branch.
4. Gating expensive agent work with `onNormalTrigger` so it skips recovery
   triggers; pair this with the existing dirty guard. Improver may still
   analyze after stash because it reviews evidence, not task progress.
5. Keeping reset idempotent and network-free. If recovery fails, the runtime
   retries once and pauses dispatch; pre-reset network effects would leak.

A workflow without file mutations but with a recovery role (e.g. attention-
digest notifications) may set `recoveryCapable: true` with `runtime.recovered`
and skip reset, but must stay idempotent and network-free before reset. A
workflow with neither role leaves it unset with a short comment (today:
`dispatcher`, `pr-reviewer`).
