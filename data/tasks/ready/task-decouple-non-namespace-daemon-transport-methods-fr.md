---
id: task-decouple-non-namespace-daemon-transport-methods-fr
title: Decouple non-namespace daemon transport methods from DaemonControlClient
status: ready
priority: p1
area: architecture
summary: Refactor the ~20 non-namespace transport methods (getDaemonStatus, pause, events, voiceTranscribe, registerSession, queryEvents, reload, …) off direct DaemonControlClient consumers in workflow-ops, daemon-ops, push-notification, mcp-server, approval-queue, history, commands, secrets, and doctor so each module consumes a small typed daemon-link surface instead of importing the central class — orthogonal to the parent KotaClient namespace chunking decision and required for all five proposed chunking answers.
created_at: 2026-05-03T04:56:19.212Z
updated_at: 2026-05-03T04:56:19.212Z
---

## Problem

`src/core/server/daemon-client.ts` is 2184 lines. About ~20 of its
public, non-namespace transport methods — `getDaemonStatus`, `pause`,
`reload`, `events`, `voiceTranscribe`, `registerSession`,
`unregisterSession`, `queryEvents`, plus a handful of related session
and run helpers — are consumed directly by route handlers and CLIs
across nine modules (`workflow-ops`, `daemon-ops`, `push-notification`,
`mcp-server`, `approval-queue`, `history`, `commands`, `secrets`,
`doctor`). Each direct import couples that module to the monolithic
`DaemonControlClient` class and requires editing
`src/core/server/daemon-client.ts` whenever a module-owned route
changes shape.

This coupling is independent of the open KotaClient namespace
distribution chunking decision (parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s`, owner-
decision slot `kotaclient-namespace-distribution-chunking`,
unanswered since 2026-04-26). All five proposed answers — single run,
per-namespace fan-out, batched, foundation+pilot+follow-ups, or
unblock — still need these non-namespace transport methods removed
from direct module callers before `daemon-client.ts` can shrink under
the 300-line guideline. Doing this work now reduces the parent task's
scope without committing to any specific chunking answer for the
namespace migration itself.

## Desired Outcome

A small typed daemon-link surface — `request<T>(method, path, body?)`
plus the shared SSE/timeout helpers genuinely needed by more than one
module — exists in `src/core/server/` and is the only daemon-side
transport surface the nine consuming modules import. The non-namespace
transport methods that today live as public `DaemonControlClient`
methods either move to module-owned wrappers (preferred when one
module owns the route, e.g. `voiceTranscribe` in `voice`,
`registerSession`/`unregisterSession` in `daemon-ops`) or stay inside
`daemon-client.ts` as transport primitives consumed only through the
typed link.

After the refactor:

- No module under `src/modules/*` imports `DaemonControlClient`
  directly to call a non-namespace transport method. Modules consume a
  typed link object or a module-owned wrapper.
- `node:http`, the bearer token, and `.kota/daemon-control.json` reads
  remain inside `src/core/server/daemon-client.ts`.
- The parent KotaClient namespace task's required precondition (route
  handlers no longer reach into the central class) is satisfied
  independently, so any chunking answer the owner picks for the
  namespace migration is implementable without first refactoring
  callers.

## Constraints

- Do not introduce a new public DaemonControlClient surface. Modules
  consume the typed link object or module-owned wrappers around it.
- Preserve the daemon HTTP wire shape exactly. This is an internal
  refactor; CLI behavior, daemon-up/daemon-down branches, and JSON /
  pipe-mode output do not change.
- Do not move per-namespace request/response types or namespace closure
  factories in this task. Those are scoped to the parent task and the
  open chunking decision.
- No legacy or compatibility surface. Update each direct caller in the
  same change; do not leave a deprecation shim on
  `DaemonControlClient`.
- Output continues to flow through `src/modules/rendering`. The
  rendering layer is not part of this refactor.
- The existing `bootstrap` exemption (`init`, `registry`, `completion`,
  `daemon-ops install`) and the existing direct-`.kota/`-read guard
  remain untouched.
- Do not invent a parallel module-contribution path. The typed link is
  a transport primitive, not a second contribution mechanism.

## Done When

- A typed daemon-link object is exposed from `src/core/server/` with a
  small surface (`request<T>`, plus the SSE/timeout helpers actually
  shared across modules). It is consumed by every module that
  previously called a non-namespace `DaemonControlClient` method.
- `src/modules/workflow-ops`, `daemon-ops`, `push-notification`,
  `mcp-server`, `approval-queue`, `history`, `commands`, `secrets`,
  and `doctor` no longer reach `DaemonControlClient` directly for
  non-namespace transport. Their imports go through the typed link or
  through a module-owned wrapper that owns the route.
- A guard test (or extension to the existing `kota-client-guard.test.ts`)
  rejects new direct imports of `DaemonControlClient` from
  `src/modules/*` outside an explicit allowlist. The allowlist names
  only modules that already own the namespace closure factory
  registered through the existing `KotaClient` registry.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `daemon-up` and `daemon-down` CLI transcripts captured under the run
  directory show parity for at least one mutation and one read in each
  consuming module's surface (e.g. `kota status`, `kota workflow runs`,
  `kota approvals list`, `kota history list`).
- `src/core/server/daemon-client.ts` line count is recorded before and
  after; the file shrinks by the surface area moved out, even though
  the parent task still owns the final <300-line target.

## Source / Intent

Extracted from
`task-distribute-kotaclient-namespace-types-and-daemon-s` (parent task
in `data/tasks/blocked/`, blocked on owner-decision
`kotaclient-namespace-distribution-chunking` since 2026-04-26). The
parent task's body explicitly names the non-namespace transport refactor
as a precondition for shrinking `daemon-client.ts` regardless of how
the per-namespace migration is chunked. Pulling this work forward
reduces the parent's scope, removes module-to-core coupling that grows
linearly with every new daemon route, and lets the namespace chunking
decision land cleanly when the owner answers.

Strategic-ready coverage was the immediate trigger: with only the
mobile conformance-decoder p3 task in `ready/` and every strategic
blocked task gated on owner-decision, operator-capture, or
capability-installed preconditions, the explorer needed an actionable
strategic next step that did not invent surface-completion fan-out
work. This is that step.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its daemon-side transport — lives in the owning
module, with `src/core/server/` reduced to genuine cross-cutting
protocols and a typed transport primitive. This task is the orthogonal
prelude to
`task-distribute-kotaclient-namespace-types-and-daemon-s`.

## Acceptance Evidence

- Diff covering the typed daemon-link primitive, every direct
  `DaemonControlClient` non-namespace import in
  `src/modules/{workflow-ops,daemon-ops,push-notification,mcp-server,approval-queue,history,commands,secrets,doctor}`,
  and the guard-test extension.
- Line-count snapshots of `src/core/server/daemon-client.ts` before
  and after; the file shrinks even though it does not yet hit the
  300-line guideline (parent task owns that goal).
- Daemon-up CLI transcript under the run directory exercising one
  representative read and one representative mutation per affected
  module (`kota status`, `kota workflow runs`, `kota approvals list`,
  `kota history list`, `kota voice transcribe …`, `kota daemon
  pause` / `resume`, `kota commands run …`, `kota secrets list`,
  `kota doctor`). Daemon-down behavior recorded for a representative
  subset.
- Test output showing the new guard-test passing on the current tree
  and failing on a deliberately-introduced direct
  `DaemonControlClient` non-namespace import in a module outside the
  allowlist.
