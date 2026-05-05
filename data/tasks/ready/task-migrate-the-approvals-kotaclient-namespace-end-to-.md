---
id: task-migrate-the-approvals-kotaclient-namespace-end-to-
title: Migrate the approvals KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: ready
priority: p1
area: architecture
summary: Move ApprovalsClient interface and the ApprovalsListResult/ApprovalListFilter/ApprovalMutateResult types from src/core/server/kota-client.ts into src/modules/approval-queue/client.ts; add a daemonClient(link) factory to the approval-queue module that wires GET /approvals, POST /approvals/:id/approve, and POST /approvals/:id/reject through the typed DaemonTransport; remove listApprovalsHttp/approveApprovalHttp/rejectApprovalHttp and the inline approvals handler closure from src/core/server/daemon-client.ts.
created_at: 2026-05-05T00:42:17.508Z
updated_at: 2026-05-05T00:42:17.508Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (`927dca24`), the audit migration (`b6278cf1`), the retract
migration (`8c212f0c`), the answer migration (`eb392cd1`), the
ownerQuestions migration (`68b74850`), the modules migration
(`c143c892`), the modulesAdmin migration (`03485329`), the agents
migration (`7965beb6`), the skills migration (`f62bbb65`), the
mcpServer migration (`10877651`), the web migration (`f79a2ee5`), the
capture migration (`e0e9aa93`), the recall migration (`5ab2bd0b`), and
the webhook migration (`201d35ce`, 2026-05-04) have validated the
`daemonClient(link)` foundation pattern by moving fifteen namespaces
out of `src/core/server/kota-client.ts` and
`src/core/server/daemon-client.ts` into their owning modules. 12
namespaces still have their TypeScript shape and daemon-side wire code
centralized in those two files (`kota-client.ts` is 1075 lines,
`daemon-client.ts` is 1777 lines, both still well over the 300-line
guideline).

The next-cleanest namespace that fits the same multi-method end-to-end
shape is `approvals`:

- 3 methods (`list(filter?)`, `approve(id, note?)`, `reject(id, reason?)`)
  — same ~3-method shape as several prior pilots.
- Already owned by a dedicated module under
  `src/modules/approval-queue/` with its own `localClient(ctx)` factory
  (`index.ts`), control routes (`approvalControlRoutes` registered
  against the daemon at `/approvals`, `/approvals/:id/approve`, and
  `/approvals/:id/reject` in `routes.ts`), and CLI (`cli.ts`).
- ~20 lines of namespace-owned types in `kota-client.ts` (lines
  378–397):
  - `ApprovalsListResult` (lines 378–380, 3 lines): the `{ approvals }`
    aggregate result.
  - `ApprovalListFilter` (lines 390–392, 3 lines): the `{ status }`
    filter shape with the `ApprovalStatus | "all"` discriminator.
  - `ApprovalMutateResult` (lines 395–397, 3 lines): the two-arm
    `{ ok: true; approval } | { ok: false; reason: "not_found" }`
    discriminated union.
  - `ApprovalsClient` (lines 583–587, 5 lines).
  - The supporting doc comments (lines 376–377, 382–389, 394).
- ~30 lines of wire code in `daemon-client.ts` —
  `listApprovalsHttp` (lines 1137–1143, 7 lines),
  `approveApprovalHttp` (lines 1145–1151, 7 lines), and
  `rejectApprovalHttp` (lines 1153–1159, 7 lines) plus the inline
  `approvals: { list, approve, reject }` closure on the central
  handler builder (lines 1294–1306, 13 lines).
- The wire code already issues GET `/approvals?status=...`, POST
  `/approvals/:id/approve`, and POST `/approvals/:id/reject` through
  `transport.request<T>` and decodes the typed result; the factory
  body collapses into three strict requests once the typed
  `DaemonTransport` link supplies the standard JSON-decode path.
- The approval-queue module's local consumers (`index.ts`) currently
  import `ApprovalsClient` from `#core/server/kota-client.js`. After
  the migration these imports point at the module-local `client.ts`,
  mirroring every prior namespace migration.

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — the same shape
as the prior pilots. The shape extends the pattern in three new
dimensions: (a) the first migration to surface a **query-string
discriminator** (`?status=pending|approved|rejected|all`) wired through
the typed link, (b) the first migration whose mutation result is a
two-arm discriminated union keyed off the daemon's `404 → not_found`
mapping (the daemon-up branch must collapse `null` from
`requestStrict<T>` into `{ ok: false, reason: "not_found" }` while
`200` returns become `{ ok: true, approval }`), validating that the
typed link's `null`-on-404 behavior threads through the
discriminator, and (c) the first migration whose `list()` filter
default differs between local and daemon-up branches: the daemon's
`/approvals` route already defaults to `pending` when no
`?status=` query is passed (see `readStatusFilter` in
`src/modules/approval-queue/routes.ts`), so the daemon-side factory
omits the query string when `filter?.status` is undefined. The local
handler already defaults to `pending` when `filter?.status` is
undefined; the daemon-up factory matches that by relying on the
daemon route's default rather than threading a default through the
factory.

## Desired Outcome

`approvals` is the sixteenth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `ApprovalsClient`, `ApprovalsListResult`, `ApprovalListFilter`, and
  `ApprovalMutateResult` live in
  `src/modules/approval-queue/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports
  `ApprovalsClient` from this module instead of declaring the types
  inline. The narrow `no-module-imports-in-core` allowlist (today:
  `server/kota-client.ts`) already covers the import; no allowlist
  edit is needed.
- `src/modules/approval-queue/index.ts` adds a `daemonClient(link)`
  factory parallel to its existing `localClient(ctx)` factory. The
  factory returns `{ approvals: ApprovalsClient }` whose three methods
  route through:
  - `list(filter?)` →
    `link.requestStrict<ApprovalsListResult>("GET", filter?.status ? `/approvals?status=${encodeURIComponent(filter.status)}` : "/approvals")`
  - `approve(id, note?)` →
    `link.request<{ approval: PendingApproval }>("POST", `/approvals/${encodeURIComponent(id)}/approve`, { note })`
    then collapsing `null` into `{ ok: false, reason: "not_found" }`
    and a non-null result into `{ ok: true, approval: result.approval }`.
  - `reject(id, reason?)` →
    `link.request<{ approval: PendingApproval }>("POST", `/approvals/${encodeURIComponent(id)}/reject`, { reason })`
    then collapsing `null` into `{ ok: false, reason: "not_found" }`
    and a non-null result into `{ ok: true, approval: result.approval }`.

  matching today's `listApprovalsHttp` / `approveApprovalHttp` /
  `rejectApprovalHttp` URL paths and HTTP verbs byte-for-byte. The
  GET and the two POSTs all use `transport.request<T>` today (the
  GET returns a typed envelope; the POSTs return `null` on 404). The
  factory uses `link.requestStrict<T>` for the GET (where `null`
  becomes `{ approvals: [] }` via the post-decode mapping the central
  closure already does today) and `link.request<T>` for the two POSTs
  so the `null`-on-404 branch maps to `{ ok: false, reason:
  "not_found" }`.
- `src/core/server/daemon-client.ts` no longer carries
  `listApprovalsHttp`, `approveApprovalHttp`, `rejectApprovalHttp`,
  the inline `approvals: { list, approve, reject }` closure on the
  core-side stub builder, the `ApprovalsListResult` /
  `ApprovalListFilter` / `ApprovalMutateResult` imports from
  `./kota-client.js`, or the `PendingApproval` /
  `ApprovalStatus` imports kept solely for those wire methods.
  Module-contributed handlers replace all of these the same way every
  prior migration did. Note the legacy class methods `listApprovals`,
  `approveApproval`, and `rejectApproval` on `DaemonControlClient`
  (lines 1683–1693) are out of scope for this task — they have no
  remaining callers across the repo (a separate cleanup will remove
  the class-method shape once `approveAllApprovals` /
  `rejectAllApprovals` are also retired). This task only removes the
  internal wire helpers and the inline closure those class methods
  would have referenced.
- `src/modules/approval-queue/index.ts` updates its import of
  `ApprovalsClient` from `#core/server/kota-client.js` to the
  module-local `./client.js`. Every other in-module consumer of these
  types follows the same shift if any reference exists.
- A new daemon-side factory unit test alongside the module
  (`src/modules/approval-queue/daemon-client.test.ts`) exercises the
  wire shape against a recording `DaemonTransport`, mirroring
  `src/modules/webhook/daemon-client.test.ts`,
  `src/modules/recall/daemon-client.test.ts`, and the prior multi-
  method pilots like `src/modules/answer/daemon-client.test.ts` and
  `src/modules/owner-questions/daemon-client.test.ts`. The test pins
  (1) the factory contributes `approvals`, (2) `list()` routes through
  `requestStrict<T>` with method `GET`, path `/approvals`, and an
  undefined body when `filter` is omitted, (3) `list({ status:
  "pending" })`, `list({ status: "approved" })`, `list({ status:
  "rejected" })`, and `list({ status: "all" })` route through
  `requestStrict<T>` with the matching `?status=...` query string,
  including a status containing reserved characters threaded through
  `encodeURIComponent`, (4) `approve(id, note?)` routes through
  `request<T>` with method `POST`, path
  `/approvals/${encodeURIComponent(id)}/approve`, and body
  `{ note }` — including an id containing `%`, `/`, and a space to
  pin the path encoding, (5) `reject(id, reason?)` routes through
  `request<T>` with method `POST`, path
  `/approvals/${encodeURIComponent(id)}/reject`, and body
  `{ reason }` — including the same encoding-sensitive id, (6) every
  `ApprovalsListResult` arm decodes correctly through `requestStrict<T>`
  (empty approvals plus a multi-entry payload mixing pending /
  approved / rejected statuses), (7) both `ApprovalMutateResult` arms
  decode correctly: a `200` `{ approval }` response collapses into
  `{ ok: true, approval }` and a `null` (404) response collapses into
  `{ ok: false, reason: "not_found" }`, asserted for both `approve`
  and `reject`, (8) the assembly satisfies coverage with the
  approvals contribution, and (9) the assembly throws naming
  "approvals" when the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"approvals"`, and `buildMigratedNamespaceTestStubs()`
  in `src/core/server/daemon-client-test-stubs.ts` extends with a
  stub `approvals` handler returning `{ approvals: [] }` from
  `list()`, `{ ok: false, reason: "not_found" }` from `approve(id)`,
  and `{ ok: false, reason: "not_found" }` from `reject(id)` so tests
  that build a `DaemonControlClient` purely to exercise non-namespace
  daemon behavior continue to pass coverage.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes or
  wire shape — the `/approvals`, `/approvals/:id/approve`, and
  `/approvals/:id/reject` control routes keep their HTTP verbs,
  query-string contracts, and JSON-body contracts exactly as parsed
  in `src/modules/approval-queue/routes.ts`. The CLI-facing `kota
  approval` subcommands and the web/mobile client wrappers are
  unrelated to this migration and must not be touched.
- The daemon-side handler uses `link.requestStrict<T>` and
  `link.request<T>` through the typed `DaemonTransport`. It does not
  reach into `node:http`, the bearer token, or
  `.kota/daemon-control.json`. The HTTP method and path stay byte-for-
  byte identical to today's wire code, including
  `encodeURIComponent(id)` on both mutation paths and
  `encodeURIComponent(status)` on the list query string so any
  embedded slashes, percents, or spaces in the approval id or status
  filter continue to round-trip safely.
- No legacy or compatibility surface. Delete `listApprovalsHttp`,
  `approveApprovalHttp`, `rejectApprovalHttp`, the inline closure,
  the central type declarations, and the `ApprovalsListResult` /
  `ApprovalListFilter` / `ApprovalMutateResult` /
  `PendingApproval` / `ApprovalStatus` imports at the migration's
  edges as it completes; do not leave shims. The in-module import
  shift in `index.ts` from `#core/server/kota-client.js` to
  `./client.js` is a hard cutover, not a parallel re-export.
- The two-arm `ApprovalMutateResult` discriminated union is preserved
  exactly: `{ ok: true; approval: PendingApproval }` and
  `{ ok: false; reason: "not_found" }`. The `ApprovalsListResult`
  shape (`{ approvals: PendingApproval[] }`) and the `ApprovalListFilter`
  shape (`{ status?: ApprovalStatus | "all" }`) are preserved
  exactly.
- The local handler's default-to-pending behavior when
  `filter?.status` is undefined is preserved by relying on the
  daemon route's existing default in `readStatusFilter` (no
  `?status=` query string sent). The daemon-up branch must not
  thread an explicit `pending` default through the factory; the wire
  contract today omits the query string in that case and the local
  branch defaults inside `getApprovalQueue().list("pending")`.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `ApprovalsListResult` / `ApprovalListFilter` /
  `ApprovalMutateResult` declarations in `src/core/server/`. Existing
  assertions for the doctor, harnessParity, audit, retract, answer,
  ownerQuestions, modules, modulesAdmin, agents, skills, mcpServer,
  web, capture, recall, and webhook migrations stay green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no allowlist
  edit is needed for this migration.
- No protocol change. CLI behavior (`kota approval list`, `kota
  approval list --status all`, `kota approval approve <id>`, `kota
  approval reject <id>`), daemon-up vs daemon-down branching, and
  `--json` output all continue to behave identically.
- Output continues to flow through `src/modules/rendering`. The
  approval-queue module's existing rendering hooks (`cli.ts`) are not
  part of this refactor.

## Done When

- `src/modules/approval-queue/client.ts` exists and declares
  `ApprovalsClient`, `ApprovalsListResult`, `ApprovalListFilter`, and
  `ApprovalMutateResult`. The `KotaClient` aggregate in
  `src/core/server/kota-client.ts` imports `ApprovalsClient` from
  this module.
- `src/modules/approval-queue/index.ts` exposes `daemonClient(link)`
  parallel to `localClient(ctx)`.
- `src/modules/approval-queue/index.ts` imports `ApprovalsClient`
  from `./client.js` (not from `#core/server/kota-client.js`). Every
  other in-module consumer follows the same shift if any reference
  exists.
- `src/core/server/daemon-client.ts` no longer carries any
  `approvals`-specific code: no `listApprovalsHttp`,
  `approveApprovalHttp`, or `rejectApprovalHttp`; no inline
  `approvals: { ... }` closure on the core-side stub builder; no
  `ApprovalsListResult` / `ApprovalListFilter` /
  `ApprovalMutateResult` imports; and no other approvals-namespace-
  specific helpers. The legacy class methods on `DaemonControlClient`
  (`listApprovals`, `approveApproval`, `rejectApproval`) are out of
  scope and remain in place.
- `src/modules/approval-queue/daemon-client.test.ts` exists and pins
  the invariants enumerated in `## Desired Outcome` above (factory
  presence, wire-shape assertions covering the GET filter omission
  and every status-discriminator value, two POST mutations with
  method/path/body assertions including the
  `encodeURIComponent(id)` round-trip on an id with reserved
  characters, per-arm `ApprovalsListResult` decoding, both
  `ApprovalMutateResult` arms decoding correctly through the `null`-
  on-404 branch, coverage success when the contribution is supplied,
  and coverage failure when it is removed).
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"approvals"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `approvals` handler whose three methods return the placeholder
  shapes in `## Desired Outcome` above.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace
  `ApprovalsListResult` / `ApprovalListFilter` /
  `ApprovalMutateResult` declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`approvals-daemon-up.txt` / `approvals-daemon-down.txt`)
  demonstrate parity for one read (`kota approval list`) and one
  mutation (`kota approval approve <id>` followed by `kota approval
  reject <id>` against synthetic queue items, or equivalent coverage
  if no live approvals exist) showing the pre/post output is
  identical across modes.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-04T23-26-10-924Z-explorer-67w6h7/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Seventeen orthogonal preludes have already landed (the foundation /
pilot / migration commits plus the webhook migration):

- `a0a5e3e2` — typed `DaemonTransport` plus non-namespace transport-
  method decoupling (the orthogonal prelude needed under all chunking
  answers).
- `203c76a6` — `daemonClient(link)` factory hook on `KotaModule`,
  `DaemonClientHandlers` assembly path on `DaemonControlClient`, and
  the per-namespace types guard
  (`kota-client-namespace-types-guard.test.ts`).
- `9f07ee87` — doctor pilot migrating the smallest namespace
  end-to-end through the new hook.
- `927dca24` — harnessParity migration extending the pattern to a
  two-method namespace.
- `b6278cf1` — audit migration extending the pattern to a
  query-string-bodied namespace.
- `8c212f0c` — retract migration extending the pattern to a JSON-body
  POST with discriminated request/result unions.
- `eb392cd1` — answer migration extending the pattern to a multi-verb
  namespace mixing POST + GET + GET-with-path-id.
- `68b74850` — ownerQuestions migration extending the pattern to two
  POSTs sharing an id-bearing path stem.
- `c143c892` — modules migration extending the pattern to the
  smallest single-method namespace.
- `03485329` — modulesAdmin migration extending the pattern to the
  first multi-namespace contribution from a single module's
  `daemonClient(link)` factory and the first cross-namespace
  dependency consumption.
- `7965beb6` — agents migration extending the pattern to the first
  pure read-only namespace shape (two GETs) and validating the
  single-status-code → 200 alignment precedent for `404 →
  { found: false }`.
- `f62bbb65` — skills migration extending the pattern to the first
  multi-status-code → 200 alignment for a typed mutation result
  (collapsing `502` and `400` not-ok arms into uniform `200`).
- `10877651` — mcpServer migration establishing the stub-only daemon-
  side handler precedent.
- `f79a2ee5` — web migration generalizing the stub-only precedent.
- `e0e9aa93` — capture migration extending the pattern to a
  four-arm `CaptureResult` discriminated union.
- `5ab2bd0b` — recall migration extending the pattern to a five-arm
  `RecallHit` discriminated union including a nested four-arm
  `result` union on the answer arm.
- `201d35ce` — webhook migration extending the pattern to the DELETE
  verb plus `encodeURIComponent`-escaped workflow id path parameters.

`approvals` is the next-cleanest multi-method namespace with three
short HTTP wire calls (GET / POST / POST) covering its complete
daemon contract — the natural next pilot in the cluster that began
with the ownerQuestions, agents, and capture migrations. It extends
the pattern in three axes the prior pilots did not exercise: (a) the
first migration to surface a query-string discriminator
(`?status=pending|approved|rejected|all`) wired through the typed
link, (b) the first migration whose mutation result is a two-arm
discriminated union keyed off the daemon's `404 → not_found` mapping,
validating that `link.request<T>`'s `null`-on-404 behavior threads
through the discriminator, and (c) the first migration where the
default-when-undefined behavior is anchored on the daemon route's
existing default rather than threaded through the factory. It is
needed under every chunking answer the owner can pick (a/b/c/d/
unblock): the approvals namespace migrates exactly once regardless
of whether the parent lands in one cohesive run or fans out across
follow-ups, so this task does not commit the owner to any specific
chunking answer; it shrinks the parent task's scope by one full
namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type and wire-code moves out of
  `src/core/server/`, the new `daemonClient(link)` factory on
  `approvalQueueModule`, the in-module import shift in `index.ts`,
  the removed `listApprovalsHttp` / `approveApprovalHttp` /
  `rejectApprovalHttp` plus inline closure plus imports from
  `src/core/server/daemon-client.ts`, and the new daemon-side unit
  test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~20-line and ~30-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`approvals-daemon-up.txt` / `approvals-daemon-down.txt`)
  exercising one read (`kota approval list`) and one mutation
  (`kota approval approve <id>` then `kota approval reject <id>`)
  with identical output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced
  `ApprovalsListResult` / `ApprovalListFilter` /
  `ApprovalMutateResult` declaration in `src/core/server/`.
