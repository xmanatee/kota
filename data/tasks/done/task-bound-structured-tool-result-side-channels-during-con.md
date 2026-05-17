---
id: task-bound-structured-tool-result-side-channels-during-con
title: Bound structured tool-result side channels during context pruning
status: done
priority: p2
area: core
summary: When old tool observations are masked or pruned, clear or bound structuredContent and _meta side channels too so rich MCP/tool results cannot keep large payloads in context after their visible content was replaced.
created_at: 2026-05-16T23:59:40Z
updated_at: 2026-05-17T00:07:27Z
---

## Problem

KOTA now preserves rich tool results across the neutral message protocol:
tool results can carry visible `content`, block content, `structuredContent`,
and `_meta`. The context-budget mechanisms still only replace the visible
`content` field when an old observation is pruned or masked. If a rich MCP or
module tool result carries a large structured payload or metadata object, that
side channel can remain attached to the old `tool_result` block even after the
visible content was replaced with a compact placeholder.

That weakens the point of pruning. Operators see a compact placeholder, but
the runtime can still keep large structured data in the conversation object and
send it through harnesses that preserve neutral tool-result side channels.

## Desired Outcome

Old tool observations are compacted as one coherent result envelope, not just
as a text field:

- when `message-pruning` replaces an old result with a summary, it also removes
  or explicitly bounds `structuredContent` and `_meta` on that same result;
- when `observation-masking` replaces an old result with an `[Observed: ...]`
  placeholder, it applies the same side-channel policy;
- image, audio, resource, and other block content remain represented by the
  compact placeholder or summary, not by hidden rich blocks left on the message;
- recent tool results stay untouched so models can still use fresh structured
  data when it is relevant;
- tests prove both text-only and enriched tool results shrink as an envelope.

## Constraints

- Keep the change inside the core loop context-management boundary; do not add
  a new transcript shape, store, or telemetry artifact.
- Preserve existing pruning/masking semantics for recency windows, error
  handling, read-only-only pruning, and idempotence.
- Do not drop fresh structured results. Only old results selected for pruning
  or masking should lose side-channel payloads.
- Do not stringify `structuredContent` into the placeholder. The compact text
  should remain a navigational hint, not a covert copy of the full result.
- Keep rich-result preservation at MCP/tool boundaries intact. This task is
  only about context-budget compaction after the result is no longer recent.

## Done When

- `pruneMessages` removes or bounds `structuredContent`, `_meta`, and rich
  block payloads whenever it replaces a tool result with a summary.
- `maskObservations` applies the same side-channel cleanup whenever it replaces
  a tool result with an `[Observed: ...]` placeholder.
- Focused tests cover enriched text results and image/rich block results for
  both pruning and masking.
- Existing context pruning, observation masking, MCP result-preservation, and
  OpenAI-tools harness tests remain green.
- Diff review shows no raw structured payload is copied into placeholder text
  or a new side-channel field.

## Source / Intent

Explorer run `2026-05-16T23-57-08-749Z-explorer-3etbf9` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` all require operator-captured artifacts and are not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

Recent watchlist gaps around MCP output schemas, MCP result variants, tool
observation summarization, GUI coordinate scaling, shipped-preset pricing, and
per-tool-call telemetry have already landed. This task opens the remaining
nonduplicative context-budget gap exposed by those same rich-result changes:
KOTA now preserves structured result side channels, so old-result pruning must
bound the whole envelope.

The scaffold command was attempted first:

```
pnpm kota task create "Bound structured tool-result side channels during context pruning" --state ready --area core --priority p2 --summary "When old tool observations are masked or pruned, clear or bound structuredContent and _meta side channels too so rich MCP/tool results cannot keep large payloads in context after their visible content was replaced."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed` in the network-restricted workflow sandbox. This file
follows the same normalized task schema manually.

External source checked:

- `https://github.com/openai/codex/releases` currently calls out MCP tool calls
  as protocol-level turn items and includes a recent fix for unbounded MCP/hook
  output growth. KOTA has already recorded per-call telemetry from that signal;
  this task applies the same bounded-output lesson to core context pruning.

Local evidence:

- `src/core/loop/message-pruning.ts` assigns `tr.content = summary` but does
  not clear `tr.structuredContent` or `tr._meta`.
- `src/core/loop/observation-masking.ts` assigns `tr.content = placeholder` but
  does not clear `tr.structuredContent` or `tr._meta`.
- Existing enriched-result tests in `message-pruning.test.ts` and
  `observation-masking.test.ts` assert the placeholder text but do not assert
  that side-channel payloads are removed or bounded.
- `src/core/agent-harness/message-protocol.ts` models `KotaToolResultBlock`
  with `content`, `structuredContent`, and `_meta`, so compaction must treat
  them as one result envelope.

## Initiative

Core-loop context hygiene: rich tool-result preservation should not create a
hidden path for old, large observations to bypass the context-budget controls.

## Acceptance Evidence

- Test transcript for the focused core-loop suites, for example
  `pnpm test src/core/loop/message-pruning.test.ts src/core/loop/observation-masking.test.ts`.
- If harness conversion behavior is touched, include the relevant harness
  adapter tests such as `pnpm test src/modules/openai-tools-agent-harness/adapter.test.ts`.
- Diff review shows old-result compaction clears or bounds side-channel payloads
  without weakening MCP/tool result preservation for fresh results.
