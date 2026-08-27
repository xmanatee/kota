---
status: done
---

# Deny stale MCP tool calls after declaration drift

## Problem

KOTA now refreshes external MCP tool registries on
`notifications/tools/list_changed` and records declaration fingerprints for
audit, telemetry, and remote-task resume safety. That closes the registry and
evidence gap, but the normal chat/session loop can still execute a remote MCP
call under stale model context.

`src/core/loop/loop-send.ts` currently snapshots
`state.mcpManager.getTools()` once near the start of `runSend()`, before the
multi-turn model/tool loop. Every model turn in that send then reuses the same
MCP tool declarations, even if the manager refreshes the server registry after
a `tools/list_changed` notification. `src/core/tools/tool-runner.ts` routes the
actual call through the live `McpManager` at execution time, so a same-name tool
whose description, schema, output schema, annotations, or task capability
changed can be invoked using a declaration the model did not see.

That is a security and correctness mismatch. A refreshed MCP registry is
useful only if the next model prompt sees the updated declaration, and a
prompt-time tool call must not execute when the remote declaration changed
before the call reached the manager.

## Desired Outcome

Remote MCP tool declarations are treated as prompt-time execution contracts:

- Each agent turn rebuilds the MCP tool list from the current `McpManager`
  state before calling the model, so added, removed, and changed tools are
  reflected in the next model prompt.
- For MCP tools exposed to the model, KOTA records the prompt-time declaration
  fingerprint for that turn.
- Before executing a remote MCP tool call, the tool runner compares the
  prompt-time fingerprint with the manager's current declaration fingerprint.
- If the current declaration is missing or differs, KOTA returns a normal
  tool-result error telling the model the MCP declaration changed and to retry
  after the refreshed tool list is shown. The remote tool is not called.
- On the following turn, the model receives the refreshed tool declaration and
  can call it under the new fingerprint.

## Constraints

- Build on the existing `McpManager` declaration fingerprint and drift
  diagnostic path. Do not add a second MCP registry, marketplace scanner, or
  raw declaration attestation system.
- Do not reject all `tools/list_changed` updates. Servers are allowed to change
  tools; this task only prevents execution under a stale prompt-time contract.
- Keep malformed refresh behavior unchanged: failed refreshes preserve the last
  known-good registry and should not create false stale-call denials.
- Keep denial text bounded and sanitized. It may name the server, tool, and
  fingerprint prefixes or changed state, but must not print raw descriptions,
  schemas, tool arguments, secrets, or tool results.
- Preserve local/non-MCP tool execution and remote MCP operation tools that do
  not have a tool declaration fingerprint unless a separate explicit invariant
  is added for those operation surfaces.
- Do not depend on operator approval for the common retry path. The stale call
  should fail closed as a normal tool result so the model can continue with
  refreshed tools.

## Done When

- `runSend()` or the equivalent loop path asks `McpManager` for current MCP
  tools inside each model turn, not once for the entire `send()` call.
- A prompt-time MCP declaration fingerprint snapshot is passed to
  `executeToolCalls()` or an equivalent boundary that lets execution prove the
  remote declaration still matches the one shown to the model.
- Remote MCP tool execution fails closed when the current declaration
  fingerprint differs from the prompt-time fingerprint, or when a tool was
  removed after it was shown. The remote server is not called in this case.
- The stale-call error is recorded in tool telemetry or structured run evidence
  with a bounded reason such as `mcp_declaration_changed_since_prompt`.
- A focused loop/tool-runner test simulates a remote MCP tool declaration
  changing after the model receives a tool list but before the tool call
  executes; the test proves the call is denied and the remote handler is not
  invoked.
- A focused next-turn test proves the refreshed declaration is exposed to the
  model on the subsequent turn and a call made under the new fingerprint can
  execute normally.
- Existing MCP refresh, declaration-fingerprint, remote-task resume,
  injection-defense provenance, and guardrails/tool-runner tests remain green.

## Source / Intent

Explorer run `2026-06-23T00-20-09-115Z-explorer-hxv31n` reviewed an empty
actionable queue (`ready=0`, `doing=0`, `backlog=0`). The surfaced strategic
blocked alternatives all still require operator-captured evidence and were not
movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-algorithmic-resource-budget-canaries-to-the-ev`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

External sources checked:

- `https://modelcontextprotocol.io/specification/draft/server/tools` is the
  official MCP draft Tools page. It states that tool lists may change over time
  and defines `notifications/tools/list_changed`; it also says clients must
  treat tool annotations as untrusted unless they come from trusted servers.
- `https://arxiv.org/abs/2602.03580` ("Don't believe everything you read:
  Understanding and Measuring MCP Behavior under Misleading Tool
  Descriptions", submitted February 3, 2026) makes mismatches between
  advertised MCP tool descriptions and actual behavior a concrete attack
  surface for agents reasoning over tool descriptions.
- `https://arxiv.org/abs/2604.05969` ("A Formal Security Framework for
  MCP-Based AI Agents", submitted April 7, 2026) reinforces defense in depth
  for MCP tool chains, including capability-aware boundaries and runtime
  policy enforcement.

Local overlap check:

- `task-refresh-remote-mcp-tool-registries-on-toolslistcha` is done and
  refreshes the manager's registry on `tools/list_changed`, but it does not
  prove the active model loop refreshes the tool declarations it shows the
  model each turn.
- `task-fingerprint-remote-mcp-tool-declarations-across-re` is done and
  records declaration fingerprints plus drift diagnostics, but it explicitly
  keeps refreshed tools available rather than failing prompt-stale calls.
- The two completed remote-task declaration-fingerprint security fixes reject
  drift across persisted task resume. They do not cover ordinary immediate
  `tools/call` execution inside a live model turn.
- `task-screen-remote-mcp-tool-results-through-injection-d` is done and screens
  external MCP result content by provenance, but result screening happens after
  a call executes; this task blocks calls whose declaration changed before
  execution.

## Initiative

MCP security and auditability: KOTA should consume remote tools through a
strict runtime boundary where the advertised contract an agent sees is the same
contract used for execution, approval, telemetry, and post-run review.

## Resolution

`runSend()` now rebuilds MCP tools inside each model turn and snapshots
prompt-time declaration fingerprints for remote MCP tools. `executeToolCalls()`
receives that snapshot and returns a bounded
`mcp_declaration_changed_since_prompt` tool-result error before remote or local
dispatch when the current fingerprint differs or is missing. Remote MCP
operations without declaration fingerprints keep their prior behavior.

## Acceptance Evidence

- `pnpm test src/core/loop/loop-send-mcp-declaration.test.ts src/core/tools/tool-runner-mcp-declaration-contract.test.ts src/core/tools/tool-runner-mcp-provenance.test.ts src/core/mcp/manager-declaration-fingerprint.test.ts` passed.
- `pnpm test src/core/mcp/manager.test.ts src/core/mcp/manager-declaration-fingerprint.test.ts src/core/mcp/manager-declaration-task-fingerprint.test.ts src/core/mcp/manager-provenance.test.ts src/core/tools/tool-runner.test.ts src/core/tools/tool-runner-schema.integration.test.ts src/core/tools/tool-runner-mcp-provenance.test.ts src/core/tools/tool-runner-mcp-declaration-contract.test.ts src/core/tools/tool-telemetry-mcp-provenance.test.ts` passed.
- `pnpm test src/core/loop/loop.test.ts src/core/loop/loop-send-mcp-declaration.test.ts` passed.
- `pnpm run typecheck` and `pnpm run lint` passed.
- `pnpm run validate-tasks` passed against a temporary staged index/object store; direct real-index staging is blocked in this sandbox by `.git/index.lock` permissions.
