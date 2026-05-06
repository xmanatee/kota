---
id: task-split-daemon-control-chatts-into-per-concern-sibli
title: Split daemon-control-chat.ts into per-concern sibling files
status: ready
priority: p1
area: core
summary: Collapse src/core/daemon/daemon-control-chat.ts (453 lines) into per-concern sibling files (DaemonChatPool class plus the HTTP body/SSE helpers and HTTP handlers) so each file owns one concern, matching the per-phase split pattern that landed for the surrounding daemon and workflow-runtime clusters.
created_at: 2026-05-06T02:13:57.761Z
updated_at: 2026-05-06T02:13:57.761Z
---

## Problem

`src/core/daemon/daemon-control-chat.ts` is 453 lines and bundles three
orthogonal concerns into one declaration:

- `DaemonChatPool` class with idle-TTL eviction (lines ~47–176, plus
  the `DaemonChatMakeAgent`, `DaemonChatSession`, `DaemonChatListEntry`,
  `DaemonChatPoolOptions` types and the `DEFAULT_MAX_SESSIONS` /
  `DEFAULT_TTL_MS` constants). This is the durable runtime cache that
  owns daemon-side `AgentSession` lifecycle.
- HTTP request body parsing (`readChatBody`, lines ~178–203) and SSE
  frame writer (`writeSse`, lines ~205–208). These are protocol
  primitives that belong to the daemon-chat HTTP surface, not to the
  pool's session-lifetime concern.
- HTTP handlers (`handleCreateDaemonSession`, `handlePatchDaemonSession`,
  `handleDaemonChat`, `deleteDaemonSession`, plus the
  `DaemonChatConversationResolver` type, lines ~210–453). These wire
  the pool and bindings store into the daemon control routes; their
  blast radius is the route table, not the pool's runtime contract.

The shape repeats the architectural-anchor pattern explorer keeps
finding across `src/core/`: one file accreting helpers from three
different migrations. The companion test file
`daemon-control-chat.test.ts` already groups assertions by concern with
top-level `// --- DaemonChatPool ---`, `// --- handleCreateDaemonSession ---`,
`// --- readChatBody ---`, `// --- handleDaemonChat ---`, and integration
sections. The seam is established in the test file; the source file just
hasn't followed yet.

## Desired Outcome

`daemon-control-chat.ts` is gone. Two focused siblings own the concerns,
co-located with the existing `daemon-chat-bindings.ts` sibling so the
`daemon-chat-*` cluster is one coherent surface:

- `daemon-chat-pool.ts` — `DaemonChatPool` class plus the
  `DaemonChatMakeAgent`, `DaemonChatSession`, `DaemonChatListEntry`,
  and `DaemonChatPoolOptions` types and the
  `DEFAULT_MAX_SESSIONS` / `DEFAULT_TTL_MS` constants. This is the
  durable runtime contract.
- `daemon-chat-handlers.ts` — `readChatBody`, the (now exported, since
  it crosses the file boundary) `writeSse`, the four HTTP handlers
  (`handleCreateDaemonSession`, `handlePatchDaemonSession`,
  `handleDaemonChat`, `deleteDaemonSession`), and the
  `DaemonChatConversationResolver` type they consume.

The companion `daemon-control-chat.test.ts` is split or renamed to match
the new owners (`daemon-chat-pool.test.ts` plus
`daemon-chat-handlers.test.ts`); the integration sections that exercise
the full `DaemonControlServer` flow can land in whichever sibling test
file is the natural home (handlers, since the integration surfaces are
HTTP routes), or in a co-located `daemon-chat.integration.test.ts` if
that is cleaner. Per-concern coverage stays at parity; do not delete
tests during the move.

`daemon-control-routes.ts`, `daemon-control.ts`, and any other consumer
imports directly from the new siblings. No second public surface
remains; `daemon-control-chat.ts` is deleted, not converted to a
re-export shim.

## Constraints

- One mechanism: continue the existing per-concern sibling-file pattern
  in `src/core/daemon/`. Do not introduce a new directory layer or a
  parallel registry.
- No backwards-compatibility re-export shim. Update every consumer of
  `daemon-control-chat.js` to import from the new sibling that owns the
  symbol. Delete `daemon-control-chat.ts` at the end of the change.
- Keep public export names unchanged (`DaemonChatPool`,
  `DaemonChatMakeAgent`, `DaemonChatListEntry`, `DaemonChatPoolOptions`,
  `DaemonChatConversationResolver`, `readChatBody`,
  `handleCreateDaemonSession`, `handlePatchDaemonSession`,
  `handleDaemonChat`, `deleteDaemonSession`). The split is internal.
  `writeSse` becomes exported from `daemon-chat-handlers.ts` if and only
  if the test split needs to assert against it directly; otherwise it
  stays a private helper inside the handlers file.
- Match the existing naming convention. The directory already has
  `daemon-chat-bindings.ts`; the new files use the same
  `daemon-chat-*` prefix, not `daemon-control-chat-*`. The
  `daemon-control-*` prefix in the file directory names route-table
  / control-server plumbing, not the chat session model.
- `src/strict-types-policy-baseline.json` may shift entries from
  `daemon-control-chat.ts` to the new sibling files but must not gain
  net new `unknown` / `Record<string, unknown>` / `as unknown` usages.
- Update `src/core/daemon/AGENTS.md` to name the per-concern split
  convention for the `daemon-chat-*` cluster if the existing prose does
  not already cover it. Keep the file's budget; replace stale references
  rather than appending.
- No test-only flags or hooks introduced just to make the split easier;
  use existing public APIs.

## Done When

- `src/core/daemon/daemon-control-chat.ts` is deleted.
- `src/core/daemon/daemon-chat-pool.ts` and
  `src/core/daemon/daemon-chat-handlers.ts` exist with the symbol
  assignments described above; each stays well under 300 lines.
- All consumers (notably `daemon-control-routes.ts`, `daemon-control.ts`,
  and the test file(s)) import from the new siblings;
  `grep -rn "from \"./daemon-control-chat" src/` and
  `grep -rn "from \"#core/daemon/daemon-control-chat" src/` both return
  no matches.
- The test file is split or renamed to follow the code; both subjects
  retain their existing assertions and `// ---` section coverage.
- `pnpm typecheck` and `pnpm test` pass.
- `src/core/daemon/AGENTS.md` (or the closest applicable local
  `AGENTS.md`) names the per-concern `daemon-chat-*` split convention.

## Source / Intent

Continuation of the architectural-anchor split cluster that landed
McpServer (841 → 197 via per-feature handlers), ModuleLoader (814 →
split via per-load-phase handlers), Daemon (666 → 215 via per-lifecycle
siblings), step-executor-agent (603 → 249 via per-phase siblings),
WorkflowRuntime (591 → split via per-lifecycle phases), and
run-store-helpers (527 → split into per-concern siblings) on consecutive
recent autonomy runs (commits 22f89e05, 70bffdf5, 28d13814, c1e6b1f4,
3f5c0d44, 003e4cc3, 4d03ac28). `daemon-control-chat.ts` is now the
largest remaining non-pure-type file in `src/core/daemon/` after the
Daemon class split and the unified daemon-control route registry, and
its test file already groups assertions by the natural seam, so the
split is clean follow-up rather than a fresh pattern.

## Initiative

Minimal-core / module-first architecture: shrink the largest core
files into focused per-concern siblings so each new daemon control-
plane migration has a clear landing seam instead of a monolith to grow.

## Acceptance Evidence

- `wc -l` recorded for `daemon-control-chat.ts` (453) before and for
  each new sibling (each well under 300) after, captured in the commit
  message.
- New file list and per-symbol relocation captured in the commit
  message body.
- `pnpm typecheck` and `pnpm test` transcripts clean (covered by the
  builder repair-loop checks; the commit message references the
  validation gates that ran).
- `grep` search confirming `daemon-control-chat` is no longer imported
  from `src/`.
- `src/core/daemon/AGENTS.md` (or the closest applicable local
  `AGENTS.md`) lists the per-concern `daemon-chat-*` convention.
