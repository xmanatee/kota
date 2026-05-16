---
id: task-centralize-tool-observation-summarization-around-t
title: Centralize tool observation summarization around the agent message protocol
status: done
priority: p2
area: core
summary: Replace duplicate tool-use parsing and placeholder heuristics in core loop context masking/pruning with one typed helper grounded in KOTA's agent message protocol.
created_at: 2026-05-16T02:51:19.000Z
updated_at: 2026-05-16T03:01:36.000Z
---

## Problem

KOTA already has a strict `KotaAgentMessage` / `KotaToolUseBlock` /
`KotaToolResultBlock` protocol, but core context management still maintains
parallel tool-observation logic:

- `src/core/loop/message-pruning.ts` builds its own tool-use map and summary
  vocabulary for read-only tools.
- `src/core/loop/observation-masking.ts` builds another tool-use map and a
  broader placeholder vocabulary.
- `src/modules/workflow-ops/runs/workflow-logs.ts` formats agent tool-call
  messages through a separate path.

That duplication makes context compaction and operator logs easier to drift.
The current Goose release signal reinforces the same architectural lesson:
runtime artifacts should be based on protocol messages rather than regex or
ad-hoc artifact heuristics. KOTA has the protocol already; the gap is that
the core-loop summarizers are not sharing it.

## Desired Outcome

One typed helper owns extraction and human-readable labeling for tool
observations. Context pruning, observation masking, and workflow-log rendering
reuse that helper instead of maintaining separate tool-name switches and
`tool_use_id` maps.

The behavior stays intentionally small: this is not a new event protocol, not
a new log store, and not another agent-message variant. It is a consolidation
of existing protocol-derived labels so future tool additions have one place to
teach KOTA how to summarize old observations.

## Constraints

- Keep the helper in the narrowest core location that both pruning and masking
  can consume without importing modules into core.
- Preserve current masking/pruning semantics: recent-window behavior,
  idempotence, image-result handling, error-result treatment, and
  read-only-only pruning must not change accidentally.
- Do not add permissive `Record<string, unknown>` casts beyond the existing
  protocol boundary. Malformed protocol data should remain loud in tests.
- Do not create a parallel durable log or artifact surface. Existing run
  events and workflow logs remain the source of truth.
- Keep workflow-log changes limited to shared formatting/extraction if needed;
  do not redesign operator output in this task.

## Done When

- A shared typed helper extracts tool-call metadata and produces compact labels
  for `KotaToolUseBlock` / `KotaToolResultBlock` observations.
- `message-pruning.ts` and `observation-masking.ts` both consume that helper
  and no longer duplicate `buildToolCallMap` logic.
- Existing behavior is covered by focused tests for file reads, grep/glob,
  shell/process/code execution, delegate, image content, already-masked
  content, error results, and unknown tools.
- Workflow-log formatting either reuses the same label helper or has a short
  explicit reason in code for keeping a different operator-log format.
- The relevant unit tests pass without weakening the context budget or
  observation-masking assertions.

## Source / Intent

Explorer run `2026-05-16T02-47-58-705Z-explorer-exitzp` reviewed the empty
queue and current watchlist. The strategic blocked tasks are all still gated
on operator-captured artifacts, so this task opens a ready core-loop slice
instead of adding another blocked item.

External signal: `https://github.com/block/goose/releases` now includes a
release note for replacing artifact heuristics / regexes with protocol
messages, plus related work around session ids and skill discoverability.
KOTA should not copy Goose's implementation, but the protocol-over-heuristics
lesson matches an existing local duplication in context masking/pruning.

Local evidence:

- `src/core/loop/message-pruning.ts`
- `src/core/loop/observation-masking.ts`
- `src/core/agent-harness/agent-message.ts`
- `src/modules/workflow-ops/runs/workflow-logs.ts`

## Initiative

Core-loop protocol hygiene: KOTA's context-budget mechanisms should consume
the same typed agent-message protocol as the rest of the runtime, so old tool
observations remain compact without accumulating parallel heuristics.

## Acceptance Evidence

- Test transcript for the focused core-loop suites, for example
  `pnpm test src/core/loop/message-pruning.test.ts src/core/loop/observation-masking.test.ts`.
- If workflow-log formatting changes, include
  `pnpm test src/modules/workflow-ops/runs/workflow-logs.test.ts`.
- Diff review shows one shared tool-observation helper and no duplicated
  `buildToolCallMap` implementation in the two core-loop files.
