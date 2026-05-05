---
id: task-drive-daemon-clientts-under-the-300-line-guideline
title: Drive daemon-client.ts under the 300-line guideline as the final shrinkage step
status: done
priority: p1
area: architecture
summary: Drive src/core/server/daemon-client.ts under the 300-line guideline by extracting non-namespace transport methods into a sibling file (or module-owned wrappers) and inlining the trivial HTTP helper functions, finishing the parent KotaClient namespace distribution task.
created_at: 2026-05-05T08:09:06.754Z
updated_at: 2026-05-05T08:20:22.578Z
---

## Problem

`src/core/server/daemon-client.ts` is currently 517 lines (`wc -l` at
HEAD `eb13529e`). The companion file `src/core/server/kota-client.ts`
is at 150 lines after the workflow namespace migration landed (commit
`eb13529e`, 2026-05-05) and is well under the 300-line guideline.
`daemon-client.ts` is the last unmet line-count constraint on the
parent task `task-distribute-kotaclient-namespace-types-and-daemon-s`
("Both `kota-client.ts` and `daemon-client.ts` end up under the repo's
300-line file-size guideline.").

The remaining 517 lines fall into three groups, all genuinely belonging
to "core daemon transport" but mechanically duplicative:

- ~165 lines (lines 47–215) of transport-bound HTTP helper functions
  (`getHealthHttp`, `getDaemonStatusHttp`, `getCapabilitiesHttp`,
  `getIdentityHttp`, `getWorkflowStatusHttp`,
  `getWorkflowDefinitionsHttp`, `pauseHttp`, `resumeHttp`, `abortHttp`,
  `reloadHttp`, `reloadConfigHttp`, `enableWorkflowHttp`,
  `disableWorkflowHttp`, `triggerWorkflowHttp`, `abortRunHttp`,
  `cancelRunHttp`, `listWorkflowRunsHttp`, `getWorkflowRunHttp`). After
  the per-namespace migrations, only `daemonManagedHttp` is exported
  and consumed outside the file (by `src/modules/daemon-ops/index.ts`);
  the other 17 helpers are private and only called by the corresponding
  class methods 100 lines below.
- ~50 lines (lines 273–335) of namespace field declarations and
  constructor wiring on `DaemonControlClient`. This is irreducible — it
  is the assembly surface required to satisfy `KotaClient`.
- ~140 lines (lines 380–516) of class non-namespace methods
  (`getHealth`, `getDaemonStatus`, `getCapabilities`, `getIdentity`,
  `getWorkflowStatus`, `getWorkflowDefinitions`, `pause`, `resume`,
  `abort`, `reload`, `reloadConfig`, `enableWorkflow`,
  `disableWorkflow`, `trigger`, `dryRun`, `abortRun`, `cancelRun`, the
  five `*Approval*` methods, `listWorkflowRuns`, `getWorkflowRun`,
  `registerSession`, `unregisterSession`, `queryEvents`, `events`).
  Each method is a one-line delegation to the matching HTTP helper, or
  a 3–5 line inline `safeFetchRaw` arm.

The earlier task `task-decouple-non-namespace-daemon-transport-methods-fr`
removed direct module-side imports of these methods (modules now use
the typed `DaemonTransport` link). That left the methods on the class
purely as a daemon-side surface for `DaemonLink`, the daemon proxy
routes, and the integration tests. They no longer need both a private
helper and a public class method; one layer is redundant.

## Desired Outcome

`src/core/server/daemon-client.ts` ends under the 300-line guideline
with no loss of behavior. Two reduction levers, applied together:

- **Inline the 17 redundant private helpers.** Replace each helper-
  plus-class-method pair with a single class method that calls
  `this.transport.request(...)` (or `safeFetchRaw(this.transport, ...)`)
  directly. Keep `daemonManagedHttp` as an exported const because
  `daemon-ops` still imports it.
- **Extract the non-namespace transport surface into a sibling file.**
  Move the now-inlined non-namespace methods into
  `src/core/server/daemon-control-methods.ts` as standalone functions
  taking a `DaemonTransport`. `DaemonControlClient` exposes them by
  delegation, mirroring how it already delegates namespace fields to
  `DaemonClientHandlers`. This leaves `daemon-client.ts` focused on
  one job: assembling and validating namespace handlers and exposing
  the non-namespace transport surface as a thin façade.

After the refactor, `daemon-client.ts` should hold:

- Imports + `safeFetchRaw` (if still needed) + `daemonManagedHttp`.
- `buildCoreStubDaemonClientHandlers` and
  `assembleDaemonClientHandlers`.
- The `DaemonControlClient` class with its namespace fields,
  constructor, three factory methods (`fromAddress`,
  `fromTransport`, `fromAddressWithFactory`), and thin delegations to
  the extracted non-namespace transport functions.

The choice between "inline only" vs "inline + extract" is the
builder's: pick whichever lands `daemon-client.ts` under 300 lines
without inflating either file beyond the guideline. Either path is
acceptable as long as the final state is consistent.

## Constraints

- No protocol change. Daemon HTTP routes, request/response shapes,
  status-code branches (404, 409, 422), and the `null`-on-network-
  failure contract stay exactly as they are. CLI behavior under
  daemon-up and daemon-down branches is preserved.
- No second public client surface. `DaemonControlClient` remains the
  daemon-online implementor of `KotaClient`. The non-namespace methods
  remain reachable via the class; their migration is mechanical, not a
  surface change.
- `daemonManagedHttp` stays exported. `src/modules/daemon-ops/index.ts`
  imports it; do not break that import.
- The existing namespace-registration guard
  (`src/core/server/kota-client-guard.test.ts`) and the per-module
  `daemon-client.test.ts` files keep passing without modification —
  this is a transport-layer refactor, not a namespace change.
- No test-only flags or backwards-compatibility shims. Delete the old
  helpers when you replace them; delete the old class method bodies
  when you replace them with delegations. No deprecation comments.
- `src/core/server/` continues to own `node:http` access, the bearer
  token, and `.kota/daemon-control.json` reads. No other directory
  reaches into those primitives.

## Done When

- `wc -l src/core/server/daemon-client.ts` reports under 300 lines.
- `wc -l src/core/server/kota-client.ts` continues to report under
  300 lines.
- If a sibling file is introduced (e.g.
  `daemon-control-methods.ts`), it is also under the 300-line
  guideline.
- The 17 private HTTP helpers (`getHealthHttp`, `getDaemonStatusHttp`,
  `getCapabilitiesHttp`, `getIdentityHttp`, `getWorkflowStatusHttp`,
  `getWorkflowDefinitionsHttp`, `pauseHttp`, `resumeHttp`, `abortHttp`,
  `reloadHttp`, `reloadConfigHttp`, `enableWorkflowHttp`,
  `disableWorkflowHttp`, `triggerWorkflowHttp`, `abortRunHttp`,
  `cancelRunHttp`, `listWorkflowRunsHttp`, `getWorkflowRunHttp`) no
  longer exist as separate functions; their bodies are either inlined
  into class methods or live as standalone exported functions in the
  sibling file.
- `daemonManagedHttp` is still exported from `daemon-client.ts` and
  still imported by `src/modules/daemon-ops/index.ts`.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- The parent task `task-distribute-kotaclient-namespace-types-and-
  daemon-s` can move to `done` after this lands — confirm by reading
  its "Done When" against the post-refactor tree and recording the
  match in the run directory.

## Source / Intent

After 26 per-namespace migrations (commits `9f07ee87` through
`eb13529e`, 2026-05-03 — 2026-05-05) and the orthogonal
non-namespace-transport decouple (`task-decouple-non-namespace-daemon-
transport-methods-fr`, done 2026-05-03), `daemon-client.ts` still sits
at 517 lines, blocking the parent task's "Both files under the 300-line
guideline" criterion. This is the last mechanical step before the
parent task is closeable. Surfaced by explorer in
`.kota/runs/2026-05-05T08-06-16-547Z-explorer-u34cur/` after the
workflow namespace migration completed and the actionable queue
returned to empty.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives. This task closes the parent KotaClient
namespace distribution effort by making the daemon-side composer file
match the file-size guideline that applies to the rest of `src/core/`.

## Acceptance Evidence

- `wc -l` snapshots of `src/core/server/daemon-client.ts`,
  `src/core/server/kota-client.ts`, and any new sibling file before
  and after, under the run directory.
- Diff covering the helper inlining and (if used) the sibling-file
  extraction, including any updated imports in `src/core/` and
  `src/modules/daemon-ops/`.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` transcripts under the
  run directory showing all green.
- Confirmation note under the run directory recording the parent
  task's "Done When" against the post-refactor tree, plus a queue
  move of `task-distribute-kotaclient-namespace-types-and-daemon-s`
  from `blocked/` to `done/` when every criterion matches.
