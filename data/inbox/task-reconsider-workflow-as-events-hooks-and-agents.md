---
title: Reconsider whether workflows should collapse into events, hooks, steps, and agents
created_at: 2026-05-07T12:27:35.000Z
source: owner
---

Owner question:

Maybe the current `workflow` concept is too complex, rough, and rigid. Research
whether the system can be simpler and more flexible if the durable runtime
concepts are just events, hooks, steps, agents, and modules, with "workflow" as
a paper/grouping concept rather than a separate code-level abstraction.

Things to investigate:

- Could builder/improver/index-sorter/etc. be modeled as modules that register
  hooks on events instead of workflow definitions with fixed step contracts?
- What rails would replace the current workflow contract?
- How many hooks should be allowed per event, and when should fan-out become a
  warning?
- How should the system visualize all global flows: event -> hook -> step ->
  agent/check -> emitted event?
- What validation is required so hooks cannot reference nonexistent events,
  create runaway fan-out, or hide dangerous side effects?
- Can this make the system both simpler and more flexible, or would it just
  recreate workflows under a less explicit name?

Important context:

Current docs intentionally say `workflow` is first-class automation:
`docs/ARCHITECTURE.md` defines workflows as deterministic triggers plus ordered
steps, and warns against adding a second automation engine. This capture should
therefore be researched as an architecture challenge, not implemented directly.

Initial research notes:

- KOTA already has most of the proposed lower-level pieces: module-declared
  events, event-triggered workflows, `emit` steps, `trigger` steps,
  `await-event`, approval, branch, foreach, and parallel steps.
- The local event bus is explicitly ephemeral: no persistence and no replay.
  Replacing workflows with bare hooks would remove run ordering, recovery,
  concurrency groups, input/output schemas, timeout rails, restart semantics,
  and run artifacts unless those mechanisms were rebuilt under another name.
- Prior completed work already moved in the opposite direction:
  `data/tasks/done/task-collapse-hooks-heartbeats-and-schedules-into-workflows.md`
  made workflows the public automation surface, and
  `src/modules/autonomy/AGENTS.md` currently rejects peer workflow DSLs unless
  they add semantics that KOTA cannot express.
- External primary docs point the same way:
  - GitHub Actions keeps `workflow` as the checked-in automation envelope
    triggered by events, with jobs and steps inside it:
    https://docs.github.com/en/actions/using-workflows/about-workflows
  - Temporal makes Workflow Execution durable through event history and replay;
    side effects live in Activities:
    https://docs.temporal.io/workflows
  - LangGraph durable execution depends on persistence/checkpoints and
    deterministic/idempotent steps:
    https://docs.langchain.com/oss/python/langgraph/durable-execution
  - Claude Code hooks are useful deterministic lifecycle commands, but hook
    docs describe commands around lifecycle events, not a replacement for a
    durable workflow runtime:
    https://code.claude.com/docs/en/hooks
  - CrewAI Flows use event/listener decorators, but still preserve a Flow
    abstraction with state, control flow, plotting, and execution:
    https://docs.crewai.com/en/concepts/flows

Current assessment:

Do not collapse `workflow` as a code concept as-is. The cleaner direction is to
research whether KOTA needs a better generated flow graph / hook inventory /
fan-out warning layer on top of existing workflow definitions, or clearer
terminology that presents workflows as module-owned event-to-step chains.

Revisit condition:

Only reopen the first-class `workflow` decision if research finds a simpler
contract that still preserves durability, validation, recovery, concurrency,
auditable run artifacts, and visualization without recreating workflows under a
less explicit name.
