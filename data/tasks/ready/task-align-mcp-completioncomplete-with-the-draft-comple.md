---
id: task-align-mcp-completioncomplete-with-the-draft-comple
title: Align MCP completion/complete with the draft completion contract
status: ready
priority: p2
area: modules
summary: Update the MCP server completion handler to validate the current draft completion request shape, support contextual prompt/resource completions where KOTA has finite values, and return bounded result metadata instead of silent empty fallbacks.
created_at: 2026-05-20T14:28:10.000Z
updated_at: 2026-05-20T14:28:10.000Z
---

## Problem

KOTA has an MCP `completion/complete` handler, but it still matches the first
minimal completion slice rather than the current draft completion utility:

- it casts external params directly and returns an empty completion when `ref`
  or `argument` is missing;
- it only handles two built-in prompt arguments and ignores `ref/resource`;
- it does not validate `context.arguments` for multi-argument completions;
- it does not enforce the draft result contract that caps returned values and
  uses `total` / `hasMore` when more matches exist;
- invalid prompt or resource references collapse to silent empty results rather
  than JSON-RPC invalid-params errors.

That makes KOTA advertise `completions: {}` while accepting malformed external
completion requests too permissively and while under-serving compliant MCP
hosts that send contextual completion requests.

## Desired Outcome

The MCP server completion surface is a strict adapter around KOTA's existing
prompt and resource capabilities. It validates draft `completion/complete`
requests once at the handler boundary, returns protocol errors for malformed or
unknown references, and produces bounded completion metadata for every finite
completion source KOTA actually supports.

## Constraints

- Keep the work inside `src/modules/mcp-server/`, primarily
  `mcp-handlers-completion.ts` and focused server tests.
- Do not create a second prompt or resource registry. Completion sources must
  come from the existing prompt catalog, resource definitions, workflow
  definitions, and run store.
- Do not add completions for free-text arguments or unbounded private data.
- Completion handling remains read-only and stateless.
- Keep exact MCP wire details in source types and protocol tests, not durable
  docs.

## Done When

- `completion/complete` validates `ref`, `argument`, and optional
  `context.arguments`, returning JSON-RPC `-32602` for malformed params.
- Unknown prompt or resource references return precise invalid-params errors;
  known references with no finite completion source return an explicitly tested
  empty completion.
- Existing workflow-name and recent-run-id completions still work, and tests
  cover at least one contextual prompt completion request with
  `context.arguments`.
- `ref/resource` is handled explicitly: KOTA returns completions for any known
  finite resource-template argument it exposes, or a validated empty result for
  known non-completable resource refs.
- Completion results contain at most 100 values and set `total` / `hasMore`
  correctly when the available match count exceeds the returned value count.
- Focused tests cover malformed params, unknown refs, bounded results,
  contextual prompt params, existing prompt completions, and resource-ref
  behavior.

## Source / Intent

Explorer run `2026-05-20T13-47-11-988Z-explorer-0dj4f3` opened this because
the ready queue was empty, the two backlog tasks were dependency-blocked, and
all exposed strategic blocked alternatives were still `operator-capture`
gated:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

Research source: the official MCP draft completion utility page at
https://modelcontextprotocol.io/specification/draft/server/utilities/completion
documents completion for prompt and resource references, optional
`context.arguments`, a maximum of 100 values per response, optional `total`,
`hasMore`, standard invalid-params errors, and input validation requirements.

Local evidence:

- `src/modules/mcp-server/mcp-handlers-completion.ts` casts `msg.params` to a
  loose record, silently returns empty completions for missing params, and only
  handles `ref/prompt` for `kota-trigger-workflow.workflow` and
  `kota-summarize-run.run_id`.
- `src/modules/mcp-server/server.test.ts` covers the earlier minimal behavior
  but does not cover malformed completion params, `context.arguments`,
  `ref/resource`, result bounds, or invalid-reference errors.
- Completed tasks already cover MCP prompts, project prompt templates, required
  prompt arguments, MRTR, and the original completion support. This task is the
  remaining draft completion-contract alignment slice.

The first attempt to scaffold this task with
`pnpm kota task create "Align MCP completion/complete with the draft completion contract" ...`
failed because the daemon-backed CLI path hit a local `fetch failed` transport
error in this sandbox. The file keeps the deterministic id and normalized
schema produced by the task scaffold.

## Initiative

MCP protocol fidelity: KOTA should expose module-owned capabilities through a
strict MCP adapter that accepts compliant hosts, rejects malformed external
input at the boundary, and avoids parallel registries.

## Acceptance Evidence

- Focused MCP server tests pass, for example:
  `pnpm test src/modules/mcp-server/server.test.ts`.
- Test output demonstrates malformed completion params and unknown refs fail
  with `-32602`, while valid prompt and resource-reference completion requests
  return draft-shaped bounded results.
