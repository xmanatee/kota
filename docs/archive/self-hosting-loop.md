# Workflow Runtime Architecture

This file records the implemented replacement for the old shell-based self-hosting loop.

## Current Model

- The autonomous runtime is `kota daemon`.
- Repo automation is defined in `src/workflows/<name>/workflow.ts`.
- Workflows are triggered by ordinary event-bus events such as `runtime.idle`, `workflow.completed`, `schedule.fire`, or `file.changed`.
- Workflow execution is the only repo-facing automation path. There is no separate scheduled-action executor or shell loop.

## Building Blocks

### Event Bus

The bus is the substrate for all automation. It carries runtime lifecycle events, workflow lifecycle events, scheduler events, and custom events from other modules.

### Scheduler

The scheduler creates reminders and event-triggered schedule items. It emits `schedule.fire`, but it does not directly execute prompts or agent sessions.

### Workflow Runtime

`WorkflowRuntime` loads markdown workflow definitions, validates them strictly, queues matching triggers, emits `runtime.idle` when spare cycles are available, and runs workflow steps.

Supported step types are deliberately small:

- `tool`
- `agent`
- `emit`

Anything more specialized should usually be expressed as a tool or as multiple steps rather than as a new orchestration abstraction.

### Claude Code Execution

Agent steps run through the packaged Claude Agent SDK and target the local Claude Code installation when available.

## Builder / Improver

The self-build loop is represented by two workflows:

1. `builder` runs on `runtime.idle`
2. `improver` runs on `workflow.completed` filtered to successful builder runs

That keeps the cycle event-driven and declarative:

`runtime.idle` → `builder` → `workflow.completed` → `improver` → back to idle

## Persistence

- Workflow run artifacts: `.kota/runs/<run-id>/`
- Workflow runtime state: `.kota/workflow-state.json`
- Daemon state: `.kota/daemon-state.json`

## Guardrails

- Workflow files are strict: unknown frontmatter keys and unknown step keys are rejected.
- Workflow names must match their filenames.
- Agent steps must reference an existing prompt section.
- Retriggers that happen while a workflow is already running are coalesced into one queued rerun instead of being dropped silently.
