---
id: task-split-mcpserver-class-into-per-mcp-feature-handler
title: Split McpServer class into per-MCP-feature handler files
status: ready
priority: p1
area: modules
summary: Split McpServer (mcp-server module) into per-MCP-feature handler files so the central server.ts drops well under the 300-line guideline
created_at: 2026-05-05T09:29:57.647Z
updated_at: 2026-05-05T09:29:57.647Z
---

## Problem

`src/modules/mcp-server/server.ts` is 841 lines — the largest non-test file
in the entire repo, well past the 300-line guideline. The bulk is one
`McpServer` class (~681 lines, 134-814) that owns every MCP feature area
in a single class: lifecycle/transport, the initialize/roots handshake,
resources (list/read/subscribe/unsubscribe + bus listeners), prompts
(list/get), tools (list/call), completion, sampling (createMessage +
artifact persistence), and elicitation. Every new MCP method ships as
another `private handleX` on the same class, so the central file keeps
growing and the per-feature concerns (e.g. sampling, which already owns a
co-located `writeSamplingRunArtifact`) cannot be edited without re-reading
the whole class.

The module already has split helper files (`prompts.ts`, `resources.ts`,
`mcp-server-operations.ts`, `client.ts`), so the `<feature>.ts` seam is
already established here. The class itself is what hasn't been carved up.

## Desired Outcome

`src/modules/mcp-server/server.ts` is a thin orchestrator: lifecycle
(`start`/`stop`/`isRunning`/bus subscription wiring), transport
(`handleLine` JSON-RPC dispatch + `send`/`sendResult`/`sendError`/
`sendNotification`), method-name → handler routing, and the small number
of fields the orchestrator genuinely owns. Every MCP feature area lives
in its own sibling file (e.g. `mcp-handlers-resources.ts`,
`mcp-handlers-prompts.ts`, `mcp-handlers-tools.ts`,
`mcp-handlers-sampling.ts`, `mcp-handlers-initialize.ts`,
`mcp-handlers-elicitation.ts`). Each feature module exports the handler
functions for its method set and any state the feature owns
(subscriptions, pending elicitations, sampling artifact path, roots).
The orchestrator dispatches by method name to the per-feature handlers,
passing whatever cross-cutting context is required (transport send,
client capability flags, project dir, model client). `server.ts` is well
under the 300-line guideline (target: ≤ 200 lines).

The split is per-MCP-feature, not arbitrary. Each new file has one
reason to change (one MCP feature area) and one set of dependencies.
The behaviour is unchanged — same JSON-RPC wire shape, same bus
subscriptions, same artifact persistence, same elicitation flow.

## Constraints

- Keep MCP wire behaviour byte-identical. The split is a pure refactor;
  no method name, capability flag, payload field, or response shape
  changes. The existing `server.test.ts` and the wider mcp-server test
  suite must pass without edits to assertions about wire output.
- Each feature file owns its own state (subscriptions for resources,
  pending elicitations + counter for elicitation, roots state + pending
  request for initialize, sampling model + run-artifact writer for
  sampling). The orchestrator does not hold state that only one feature
  reads.
- Use plain functions or small classes, whichever the feature naturally
  wants. Avoid creating a parallel `BaseHandler` abstraction or a second
  registry — `server.ts` is the one dispatcher, and per-feature files
  expose typed handler functions it calls. No DSL.
- Do not move types like `JsonRpcRequest`, `JsonRpcNotification`,
  `JsonRpcResponse`, `ElicitationSchema`, `ElicitationResponse`, `McpRoot`
  unless they are private to one feature. Cross-cutting types that two
  or more feature files import stay in `server.ts` (or a tiny shared
  `mcp-protocol-types.ts`); pick one and stick to it.
- Per the `simplest, clearest, most maintainable final system` rule,
  prefer a larger cohesive change over a partial split that leaves a
  half-divided server class. Split every clearly-owned MCP feature area
  in this task, not just the easiest one or two.
- No backwards-compatibility shim, alias re-exports, deprecated method
  stubs, or "moved to X" comments. Delete the old methods cleanly.
- Drop ad-hoc cleanup (e.g. unused imports, redundant `private` methods
  that only forward) that the split exposes. Do not leave dead code in
  the orchestrator.

## Done When

- `wc -l src/modules/mcp-server/server.ts` reports ≤ 200 lines.
- Each new sibling handler file is at or under the 300-line guideline.
  No new file ships at >300.
- `pnpm test --filter mcp-server` (or whichever package script the repo
  uses for module-scoped tests) passes with no edited assertions about
  MCP wire output. The full repo test suite passes.
- `pnpm typecheck` and the lint gate pass.
- `src/modules/mcp-server/AGENTS.md` is updated to name the per-feature
  file convention as the way new MCP method handlers land — one file per
  MCP feature area, dispatched from the central `server.ts`.
- A short `wc -l src/modules/mcp-server/*.ts` snapshot before/after
  ships in the run directory so the size collapse is visible.

## Source / Intent

Identified by explorer run `2026-05-05T09-24-37-603Z-explorer-z51d9d`
after the KotaClient namespace migration cluster (27+ steps) and the
DaemonControlClient non-namespace audit collapsed the central daemon-
client surfaces. With those clusters done, the largest remaining single-
file architectural anchor is `src/modules/mcp-server/server.ts` at
841 lines — the largest non-test file in the repo. It is a single
class that bundles every MCP feature area (transport, initialize,
resources, prompts, tools, sampling, elicitation, roots, completion)
and grows by one `handleX` method per new MCP method. Three strategic
blocked alternatives all carry operator-only preconditions
(operator-capture, capability-installed) and cannot be unblocked
autonomously; this task is autonomously actionable, beats them on
"available next step" grounds, and continues the recent direction of
shrinking the largest architectural anchors toward the 300-line
guideline.

## Initiative

Module-first / core-shrinking architecture: the MCP feature areas are
naturally per-feature, the module already established `prompts.ts` /
`resources.ts` / `mcp-server-operations.ts` as the split convention, and
this task brings the central `server.ts` into line with the rest of the
module. Ongoing addition of MCP methods (sampling, elicitation, roots
have all landed in recent months) makes the per-feature seam
load-bearing, not cosmetic.

## Acceptance Evidence

- `wc -l src/modules/mcp-server/*.ts` snapshot before and after the
  split, captured to the run directory under
  `.kota/runs/<run-id>/mcp-server-wc.txt`, showing `server.ts` ≤ 200
  lines and every new sibling file ≤ 300.
- Existing `src/modules/mcp-server/server.test.ts` plus the broader
  mcp-server test suite passes with no assertion edits about MCP wire
  output. Test transcript captured at
  `.kota/runs/<run-id>/test.txt`.
- `pnpm typecheck` transcript at `.kota/runs/<run-id>/typecheck.txt`.
