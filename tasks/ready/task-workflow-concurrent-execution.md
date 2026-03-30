---
id: task-workflow-concurrent-execution
title: Enable concurrent execution of independent workflow runs
status: ready
priority: p2
area: runtime
summary: The workflow runtime serializes all runs through a single active-run slot. Independent workflows block on each other, creating head-of-line blocking that limits throughput as the workflow set grows.
created_at: 2026-03-27T23:05:32Z
updated_at: 2026-03-30T01:00:00Z
---

## Problem

`WorkflowRuntime` has a `maxConcurrentRuns` config, but it defaults to 1 and
applies a single global cap with no distinction between agent-step workflows
and lightweight code-only workflows.

A slow builder or explorer run (agent step, long-running) blocks every other
workflow — including lightweight code-only workflows like the attention digest
— until it completes or times out. As KOTA gains more workflows (explorer,
builder, improver, cost reporters, attention digests, etc.), serial execution
means unrelated work queues behind whatever happens to be running. An explorer
run that takes 5 minutes blocks an attention-digest that takes 10 seconds.

## Desired Outcome

The runtime can execute multiple workflows concurrently when they are
independent (no shared write boundaries). A concurrency model that at minimum
separates agent-step workflows (one active at a time per agent) from code-only
or lightweight workflows (can run freely) would eliminate the worst blocking
cases without requiring full dependency tracking.

A simple initial shape:
- `agentConcurrency: 1` (default, keeps existing behavior for agent steps)
- `codeConcurrency: N` (code-only workflows run in parallel up to N)
- Workflow definitions can opt in to a named concurrency group to serialize
  within that group without blocking others.

## Constraints

- Do not introduce a full dependency graph or DAG scheduler in the first
  iteration — keep it simple.
- Shared resource conflicts (e.g., two workflows writing the same task file)
  must still be handled — concurrency groups are the safety valve.
- The active-run handle model must still work for status, pause, resume, and
  abort.
- `kota workflow list` and status surfaces should show multiple active runs
  if they exist.

## Done When

- Code-only workflow runs execute concurrently without waiting for an active
  agent-step run to finish.
- Agent-step workflows still serialize by default unless a workflow opts into
  a different concurrency group.
- The daemon status and `kota workflow list` output correctly reflect multiple
  active runs.
- Existing workflow tests pass; at least one concurrency integration test is
  added.
