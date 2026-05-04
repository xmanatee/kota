---
id: task-migrate-the-recall-kotaclient-namespace-end-to-end
title: Migrate the recall KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: done
priority: p1
area: architecture
summary: Move RecallClient interface and the RecallSource/RecallHit (knowledge/memory/history/tasks/answer arms)/RecallFilter/RecallResult discriminated types from src/core/server/kota-client.ts into src/modules/recall/client.ts; add a daemonClient(link) factory to the recall module that POSTs to /recall through the typed DaemonTransport; remove recallHttp and the inline recall handler closure from src/core/server/daemon-client.ts.
created_at: 2026-05-04T13:40:58.570Z
updated_at: 2026-05-04T14:10:27.000Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (`927dca24`), the audit migration (`b6278cf1`), the retract
migration (`8c212f0c`), the answer migration (`eb392cd1`), the
ownerQuestions migration (`68b74850`), the modules migration
(`c143c892`), the modulesAdmin migration (`03485329`), the agents
migration (`7965beb6`), the skills migration (`f62bbb65`), the
mcpServer migration (`10877651`), the web migration (`f79a2ee5`), and
the capture migration (`e0e9aa93`, 2026-05-04) have validated the
`daemonClient(link)` foundation pattern by moving thirteen namespaces
out of `src/core/server/kota-client.ts` and
`src/core/server/daemon-client.ts` into their owning modules. 14
namespaces still have their TypeScript shape and daemon-side wire code
centralized in those two files (`kota-client.ts` is 1269 lines,
`daemon-client.ts` is 1850 lines, both still well over the 300-line
guideline).

The next-cleanest namespace that fits the same single-method end-to-end
shape is `recall`:

- 1 method (`recall(query, filter?)`) — same single-method surface as
  the retract and capture migrations.
- Already owned by a dedicated module under `src/modules/recall/`
  with its own `localClient(ctx)` factory (`index.ts`), control routes
  (`recallControlRoutes`, registered against the daemon at `/recall`
  in `routes.ts`), provider layer (`recall-provider.ts`),
  contributors (`contributors.ts`), CLI (`cli.ts`), tool (`tool.ts`),
  rendering (`render.ts`), capability readiness
  (`capability-readiness.ts`), and dynamic state contributor
  (`system-prompt.ts`).
- ~135 lines of namespace-owned types in `kota-client.ts` (lines
  530–664):
  - `RecallSource` (lines 530–535, 6 lines): the
    `"knowledge" | "memory" | "history" | "tasks" | "answer"`
    discriminated union.
  - `RecallKnowledgeHit` (lines 538–545, 8 lines).
  - `RecallMemoryHit` (lines 548–554, 7 lines).
  - `RecallHistoryHit` (lines 557–564, 8 lines).
  - `RecallTasksHit` (lines 567–575, 9 lines).
  - `RecallAnswerHit` (lines 590–604, 15 lines): includes a nested
    discriminated `result` union (one `ok: true` arm plus three
    `ok: false` `reason` arms — `no_hits`, `semantic_unavailable`,
    `synthesis_failed`).
  - `RecallHit` (lines 611–616, 6 lines): the discriminated hit union
    over the five source arms.
  - `RecallFilter` (lines 627–631, 5 lines): the optional
    `{ topK?, minScore?, sources? }` shape.
  - `RecallResult` (lines 646–648, 3 lines): the two-arm
    discriminated envelope (`ok: true` with `hits` plus one
    `ok: false` `reason: "semantic_unavailable"` arm).
  - `RecallClient` (lines 662–664, 3 lines).
  - The supporting doc comments (lines 519–529, 537, 547, 556, 566,
    577–589, 606–610, 618–626, 633–645, 650–661).
- ~17 lines of wire code in `daemon-client.ts` —
  `recallHttp` (lines 162–177) plus the inline
  `recall: { recall: ... }` closure on the central handler builder
  (lines 1501–1503) plus the `RecallFilter`/`RecallResult` imports.
- The wire code already POSTs JSON to `/recall` and decodes the
  typed `RecallResult`; the factory body collapses into one strict
  POST against `/recall` once the typed `DaemonTransport` link
  supplies the JSON body shape.
- The recall route handler in `src/modules/recall/routes.ts`
  currently imports `RecallFilter` / `RecallHit` / `RecallResult` /
  `RecallSource` from `#core/server/kota-client.js`. After the
  migration these imports point at the module-local `client.ts`,
  mirroring the retract, answer, ownerQuestions, and capture
  migrations. The module-local re-exports in `recall-types.ts`
  (lines 20–32) shift with them, as does every in-module consumer
  (`recall-provider.ts`, `cli.ts`, `cli.test.ts`, `render.ts`,
  `routes.ts`, `routes.test.ts`, `index.ts`).

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — the same
shape as the retract and capture migrations. The wrinkle vs capture
is that the discriminated `RecallHit` union is five arms (knowledge,
memory, history, tasks, answer — with the answer arm itself carrying
a nested four-arm discriminated `result` union over `ok: true` plus
three `ok: false` `reason` arms). The result envelope itself is
simpler than capture's: only two arms (`ok: true` with `hits` plus
one `ok: false` `reason: "semantic_unavailable"` arm). Both unions
are already strictly typed.

## Desired Outcome

`recall` is the fourteenth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `RecallClient`, `RecallSource`, `RecallKnowledgeHit`,
  `RecallMemoryHit`, `RecallHistoryHit`, `RecallTasksHit`,
  `RecallAnswerHit`, `RecallHit`, `RecallFilter`, and `RecallResult`
  live in `src/modules/recall/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports `RecallClient`
  from this module instead of declaring the types inline. The narrow
  `no-module-imports-in-core` allowlist (today: `server/kota-client.ts`)
  already covers the import; no allowlist edit is needed.
- `src/modules/recall/index.ts` adds a `daemonClient(link)` factory
  parallel to its existing `localClient(ctx)` factory. The factory
  returns `{ recall: RecallClient }` whose `recall(query, filter)`
  method routes through
  `link.requestStrict<RecallResult>("POST", "/recall", { query, ...(filter && { filter }) })`,
  matching today's `recallHttp` body shape byte-for-byte.
- `src/core/server/daemon-client.ts` no longer carries `recallHttp`,
  the inline `recall: { recall: ... }` closure on the core-side stub
  builder, the `RecallFilter` / `RecallResult` imports from
  `./kota-client.js`, or any other recall-specific code.
  Module-contributed handlers replace all of these the same way every
  prior migration did.
- `src/modules/recall/recall-types.ts` updates its imports and
  re-exports of `RecallFilter`, `RecallHit`, `RecallResult`,
  `RecallSource`, `RecallKnowledgeHit`, `RecallMemoryHit`,
  `RecallHistoryHit`, `RecallTasksHit`, and `RecallAnswerHit` from
  `#core/server/kota-client.js` to the module-local `./client.js`.
  Every other in-module consumer of these types (`index.ts`,
  `recall-provider.ts`, `cli.ts`, `cli.test.ts`, `render.ts`,
  `routes.ts`, `routes.test.ts`) follows the same shift.
- A new daemon-side factory unit test alongside the module
  (`src/modules/recall/daemon-client.test.ts`) exercises the wire
  shape against a recording `DaemonTransport`, mirroring
  `src/modules/retract/daemon-client.test.ts`,
  `src/modules/answer/daemon-client.test.ts`, and
  `src/modules/capture/daemon-client.test.ts`. The test pins (1) the
  factory contributes `recall`, (2) `recall(query, filter)` routes
  through `requestStrict<T>` with method `POST`, path `/recall`, and
  body `{ query, filter }` (with `filter` omitted entirely when not
  provided, matching today's `recallHttp` byte-for-byte), (3) every
  `RecallFilter` arm threads through the wire body unchanged
  (no-filter, topK-only, minScore-only, sources-only, all-fields),
  (4) every `RecallResult` arm decodes correctly through the
  `requestStrict<RecallResult>` typed return (one `ok: true` arm with
  representative `RecallHit` discriminants from each of the five
  `source` arms — including a `RecallAnswerHit` with each of the
  three `ok: false` nested `result.reason` arms — plus the
  `ok: false` `reason: "semantic_unavailable"` arm), (5) the assembly
  satisfies coverage with the recall contribution, and (6) the
  assembly throws naming "recall" when the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"recall"`, and `buildMigratedNamespaceTestStubs()`
  in `src/core/server/daemon-client-test-stubs.ts` extends with a
  stub `recall` handler returning
  `{ ok: false, reason: "semantic_unavailable" as const }` so tests
  that build a `DaemonControlClient` purely to exercise non-namespace
  daemon behavior continue to pass coverage.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes or
  wire shape — the `/recall` control route keeps its JSON body
  contract (`{ query, filter? }`) exactly as parsed in
  `src/modules/recall/routes.ts`. The public `POST /api/recall` route
  on the regular HTTP server (if any) is unrelated to this migration
  and must not be touched.
- The daemon-side handler uses `link.requestStrict<T>` through the
  typed `DaemonTransport`. It does not reach into `node:http`, the
  bearer token, or `.kota/daemon-control.json`. The JSON body shape
  matches today's `recallHttp` byte-for-byte: `{ query }` when no
  filter is provided, `{ query, filter }` when one is — the spread
  pattern `{ query, ...(filter && { filter }) }` from the existing
  wire code is preserved verbatim so the daemon never sees a
  `filter: undefined` field.
- No legacy or compatibility surface. Delete `recallHttp`, the
  inline closure, the central type declarations, and the
  `RecallFilter`/`RecallResult` imports at the migration's edges
  as it completes; do not leave shims. The in-module import shifts
  in `recall-types.ts` (and every other in-module consumer) from
  `#core/server/kota-client.js` to `./client.js` are hard cutovers,
  not parallel re-exports.
- The two-arm `RecallResult` discriminated union is preserved
  exactly: `{ ok: true; hits: RecallHit[] }` and
  `{ ok: false; reason: "semantic_unavailable" }`. The five-arm
  `RecallHit` discriminated union (knowledge / memory / history /
  tasks / answer, each with their per-arm payload metadata) is
  preserved exactly. The `RecallAnswerHit`'s nested four-arm
  `result` union (one `ok: true` arm plus three `ok: false`
  `reason` arms — `no_hits`, `semantic_unavailable`,
  `synthesis_failed`) is preserved exactly. The optional
  `RecallFilter` shape (`{ topK?, minScore?, sources? }`) is
  preserved exactly.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `RecallFilter` / `RecallHit` / `RecallResult` /
  `RecallSource` declarations in `src/core/server/`. Existing
  assertions for the doctor, harnessParity, audit, retract, answer,
  ownerQuestions, modules, modulesAdmin, agents, skills, mcpServer,
  web, and capture migrations stay green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no allowlist
  edit is needed for this migration.
- No protocol change. CLI behavior (`kota recall <query>` and its
  `--top-k` / `--min-score` / `--sources` flags), daemon-up vs
  daemon-down branching, agent-tool behavior (`recall_tool`), dynamic-
  state contributor behavior, capability-readiness reporting, and
  `--json` output all continue to behave identically.
- Output continues to flow through `src/modules/rendering`. The
  recall module's existing rendering hooks (`render.ts`) are not
  part of this refactor.

## Done When

- `src/modules/recall/client.ts` exists and declares `RecallClient`,
  `RecallSource`, `RecallKnowledgeHit`, `RecallMemoryHit`,
  `RecallHistoryHit`, `RecallTasksHit`, `RecallAnswerHit`,
  `RecallHit`, `RecallFilter`, and `RecallResult`. The `KotaClient`
  aggregate in `src/core/server/kota-client.ts` imports `RecallClient`
  from this module.
- `src/modules/recall/index.ts` exposes `daemonClient(link)`
  parallel to `localClient(ctx)`.
- `src/modules/recall/recall-types.ts` re-exports the
  recall-namespace types from `./client.js` (not from
  `#core/server/kota-client.js`). Every other in-module consumer
  (`index.ts`, `recall-provider.ts`, `cli.ts`, `cli.test.ts`,
  `render.ts`, `routes.ts`, `routes.test.ts`) follows the same shift.
- `src/core/server/daemon-client.ts` no longer carries any
  `recall`-specific code: no `recallHttp`, no inline
  `recall: { recall: ... }` closure on the core-side stub builder,
  no `RecallFilter` / `RecallResult` imports, and no other
  recall-specific helpers.
- `src/modules/recall/daemon-client.test.ts` exists and pins the
  invariants enumerated in `## Desired Outcome` above (factory
  presence, wire shape with method/path/body assertions, per-arm
  `RecallFilter` body threading covering no-filter, topK-only,
  minScore-only, sources-only, all-fields, per-arm `RecallResult`
  decoding covering each of the five `RecallHit` `source` arms
  including each of the three `RecallAnswerHit` nested
  `result.reason` arms plus the `ok: false`
  `reason: "semantic_unavailable"` arm, coverage success when the
  contribution is supplied, and coverage failure when it is removed).
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"recall"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `recall` handler returning
  `{ ok: false, reason: "semantic_unavailable" as const }`.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace `RecallFilter`
  / `RecallResult` declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`recall-daemon-up.txt` / `recall-daemon-down.txt`) demonstrate
  parity for one read (`kota recall <query>`) showing the pre/post
  output is identical across modes. Recall is read-only, so the
  transcript exercises the read path explicitly.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-04T13-38-38-627Z-explorer-tt2ehw/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Fifteen orthogonal preludes have already landed (twelve foundation/
pilot/migration commits plus the mcpServer, web, and capture
migrations):

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
  side handler precedent: the first namespace whose
  `daemonClient(_link)` factory ignores the link transport and
  returns a fixed constant refusal.
- `f79a2ee5` — web migration generalizing the stub-only precedent to
  a second independent module and retiring the stub-only contribution
  path from core's responsibilities; every remaining centralized
  namespace in `daemon-client.ts` now issues at least one wire call.
- `e0e9aa93` — capture migration extending the pattern to a
  four-arm `CaptureResult` discriminated union (one `ok: true` arm
  with a four-arm `CaptureRecord` sub-union plus three distinct
  `ok: false` `reason` arms with per-arm payload fields).

`recall` is the next-cleanest single-method namespace whose entire
daemon contract is a single POST with a discriminated request and a
discriminated return envelope — the natural next pilot in the cluster
that began with the retract, answer, and capture migrations. It
extends the pattern in two axes the prior pilots did not exercise:
(a) a five-arm `RecallHit` discriminated union over `source`
(knowledge, memory, history, tasks, answer) where each arm carries
its own typed payload shape, and (b) a nested discriminated union on
the `answer` arm (`RecallAnswerHit.result` is itself a four-arm union
of one `ok: true` plus three `ok: false` `reason` arms). The result
envelope itself is simpler than capture's: only two arms (`ok: true`
with `hits` plus one `ok: false` `reason: "semantic_unavailable"`).
It is needed under every chunking answer the owner can pick
(a/b/c/d/unblock): the recall namespace migrates exactly once
regardless of whether the parent lands in one cohesive run or fans
out across follow-ups, so this task does not commit the owner to any
specific chunking answer; it shrinks the parent task's scope by one
full namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type and wire-code moves out of
  `src/core/server/`, the new `daemonClient(link)` factory on
  `recallModule`, the in-module import shift in `recall-types.ts`
  (and every other in-module consumer of the recall-namespace
  types), the removed `recallHttp` plus inline closure plus
  imports from `src/core/server/daemon-client.ts`, and the new
  daemon-side unit test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~135-line and ~20-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`recall-daemon-up.txt` / `recall-daemon-down.txt`) exercising
  one read (`kota recall <query>`) with identical output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced `RecallFilter` /
  `RecallResult` declaration in `src/core/server/`.
