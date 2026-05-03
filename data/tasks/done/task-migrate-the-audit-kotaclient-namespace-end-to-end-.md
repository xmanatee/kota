---
id: task-migrate-the-audit-kotaclient-namespace-end-to-end-
title: Migrate the audit KotaClient namespace end-to-end through the daemonClient(link) factory hook (foundation pilot follow-up)
status: done
priority: p1
area: architecture
summary: Move AuditClient interface and AuditListEntry/AuditListFilter/AuditListResult from src/core/server/kota-client.ts into src/modules/guardrails-audit/client.ts; add a daemonClient(link) factory to the guardrails-audit module that calls /audit through the typed DaemonTransport; remove listAuditHttp and the inline audit handler closure from src/core/server/daemon-client.ts.
created_at: 2026-05-03T07:42:02.895Z
updated_at: 2026-05-03T07:52:26.322Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03) and the harnessParity
follow-on (commit `927dca24`, 2026-05-03) validated the
`daemonClient(link)` foundation pattern by moving the two smallest
namespaces out of `src/core/server/kota-client.ts` and `src/core/server/
daemon-client.ts` into their owning modules. 21 namespaces still have
their TypeScript shape and daemon-side wire code centralized in those
two files.

The next-smallest namespace that fits the same end-to-end shape is
`audit`:

- 1 method (`list(filter?)`) — same single-method surface as the doctor
  pilot's `run` + `fix` shape.
- Already owned by a dedicated module under `src/modules/guardrails-
  audit/` with its own `localClient(ctx)` factory, control routes
  (`auditControlRoutes`, registered against the daemon at `/audit`),
  operations layer (`audit-operations.ts`), and CLI (`cli.ts`).
- ~38 lines of namespace-owned types in `kota-client.ts`
  (lines 1574–1611: `AuditListEntry`, `AuditListFilter`,
  `AuditListResult`, `AuditClient`).
- ~22 lines of wire code in `daemon-client.ts` — `listAuditHttp`
  (lines 359–379) plus the inline `audit: { list: ... }` closure on the
  central handler builder (line 1876–1878).
- The wire code already uses the same `URLSearchParams` + bearer-header
  shape doctor migrated to `link.requestStrict<T>` against, so the
  factory body collapses into one strict GET against `/audit`.

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — the same shape
as the doctor and harnessParity pilots.

## Desired Outcome

`audit` is the third namespace to leave `src/core/server/` end-to-end
through the `daemonClient(link)` foundation hook:

- `AuditClient`, `AuditListEntry`, `AuditListFilter`, and
  `AuditListResult` live in `src/modules/guardrails-audit/client.ts`.
  The aggregate `KotaClient` interface in `src/core/server/kota-
  client.ts` imports `AuditClient` from the module instead of declaring
  the types inline. The narrow `no-module-imports-in-core` allowlist
  extends to the new file by the same single-pattern allowance the
  doctor pilot established.
- `src/modules/guardrails-audit/index.ts` exposes a `daemonClient(link)`
  factory parallel to its existing `localClient(ctx)` factory. The
  factory returns `{ audit: AuditClient }` backed by
  `link.requestStrict<AuditListResult>("GET", "/audit", undefined, { query })`
  (or the equivalent typed query helper the foundation exposes).
- `src/core/server/daemon-client.ts` no longer carries `listAuditHttp`,
  the inline `audit: { list: ... }` closure on the core-side stub, the
  `AuditListFilter` / `AuditListResult` imports, or any other
  audit-specific code. Module-contributed handlers replace all of these
  the same way the doctor and harnessParity migrations did.
- A new daemon-side factory unit test alongside the module
  (`src/modules/guardrails-audit/daemon-client.test.ts`) exercises the
  wire shape against a mock `DaemonTransport`, mirroring `src/modules/
  doctor/daemon-client.test.ts` and `src/modules/harness-parity/
  daemon-client.test.ts`. The test pins (1) the factory exists, (2)
  `list` routes through `requestStrict<T>`, (3) filter fields thread
  into the query string, (4) the assembly satisfies coverage with the
  audit contribution, and (5) the assembly throws naming "audit" when
  the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"audit"`, and `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `audit` handler so tests that build a `DaemonControlClient` purely to
  exercise non-namespace daemon behavior continue to pass coverage.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes or wire
  shape — the `/audit` control route keeps its query string contract
  (`tool`, `risk`, `policy`, `since`, `session`, `limit`) exactly as
  registered by `auditControlRoutes`. The public `GET /api/audit` route
  on the regular HTTP server is unrelated to this migration and must
  not be touched.
- The daemon-side handler uses `link.requestStrict<T>` through the typed
  `DaemonTransport`. It does not reach into `node:http`, the bearer
  token, or `.kota/daemon-control.json`. The query-string serialization
  matches today's `listAuditHttp` byte-for-byte (no opportunistic
  encoding cleanup).
- No legacy or compatibility surface. Delete `listAuditHttp`, the inline
  closure, and the central type declarations as the migration
  completes; do not leave shims.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts` continues
  to pass and rejects a deliberately re-introduced per-namespace
  `Audit*` declaration in `src/core/server/`. Existing assertions for
  the doctor and harnessParity migrations stay green.
- The existing `no-module-imports-in-core` guard (under
  `src/core/agent-harness/`) is extended by adding the new
  `src/modules/guardrails-audit/client.ts` to the same narrow file-
  scoped allowlist the doctor pilot established. The sibling assertion
  that the allowlist itself stays load-bearing as namespaces continue
  to migrate must continue to hold.
- No protocol change. CLI behavior (`kota audit list ...`), daemon-up
  vs daemon-down branching, and `--json` output all continue to behave
  identically.
- Output continues to flow through `src/modules/rendering`. The
  guardrails-audit module's existing rendering hooks are not part of
  this refactor.

## Done When

- `src/modules/guardrails-audit/client.ts` exists and declares
  `AuditClient`, `AuditListEntry`, `AuditListFilter`, and
  `AuditListResult`. The `KotaClient` aggregate in `src/core/server/
  kota-client.ts` imports `AuditClient` from this module.
- `src/modules/guardrails-audit/index.ts` exposes `daemonClient(link)`
  parallel to `localClient(ctx)`.
- `src/core/server/daemon-client.ts` no longer carries any
  `audit`-specific code: no `listAuditHttp`, no inline `audit: { list:
  ... }` closure on the core-side stub builder, no `AuditListFilter` /
  `AuditListResult` imports, and no other audit-specific helpers.
- `src/modules/guardrails-audit/daemon-client.test.ts` exists and
  covers the wire shape, query-string threading, coverage success, and
  coverage failure when the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"audit"`, and
  `buildMigratedNamespaceTestStubs()` in `src/core/server/daemon-
  client-test-stubs.ts` extends with a stub `audit` handler.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects a deliberately re-introduced per-namespace `AuditListEntry`
  declaration in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`audit-daemon-up.txt` / `audit-daemon-down.txt`) demonstrate parity
  for one read (`kota audit list --limit 5`) showing the pre/post
  output is identical. Audit is read-only at this surface, so no
  mutation transcript is required.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-03T07-37-41-640Z-explorer-o95c5e/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Four orthogonal preludes have already landed:

- `a0a5e3e2` — typed `DaemonTransport` plus non-namespace transport-
  method decoupling (the orthogonal prelude needed under all chunking
  answers).
- `203c76a6` — `daemonClient(link)` factory hook on `KotaModule`,
  `DaemonClientHandlers` assembly path on `DaemonControlClient`, and
  the per-namespace types guard
  (`kota-client-namespace-types-guard.test.ts`).
- `9f07ee87` — doctor pilot migrating the smallest namespace end-to-end
  through the new hook, validating the pattern.
- `927dca24` — harnessParity migration extending the pattern to a
  two-method namespace, confirming the per-namespace shape generalizes.

`audit` is the third-smallest namespace and the natural next pilot. It
is needed under every chunking answer the owner can pick
(a/b/c/d/unblock): the audit namespace migrates exactly once regardless
of whether the parent lands in one cohesive run or fans out across
follow-ups, so this task does not commit the owner to any specific
chunking answer; it shrinks the parent task's scope by one full
namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols and
runtime primitives.

## Acceptance Evidence

- Diff covering namespace type and wire-code moves out of
  `src/core/server/`, the new `daemonClient` factory on
  `guardrailsAuditModule`, and the new daemon-side unit test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~38-line and ~22-line shrinkage.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`audit-daemon-up.txt` / `audit-daemon-down.txt`) showing one read
  (`kota audit list --limit 5`) with identical output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced
  `AuditListEntry` declaration in `src/core/server/`.
