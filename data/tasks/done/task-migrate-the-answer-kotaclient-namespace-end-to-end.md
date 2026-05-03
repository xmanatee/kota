---
id: task-migrate-the-answer-kotaclient-namespace-end-to-end
title: Migrate the answer KotaClient namespace end-to-end through the daemonClient(link) factory hook (foundation pilot follow-up)
status: done
priority: p1
area: architecture
summary: Move AnswerClient interface, AnswerFilter/AnswerResult/AnswerCitation/AnswerHistoryRecord/AnswerHistoryListFilter/AnswerHistoryListResult/AnswerHistoryShowResult/AnswerHistoryEntry types from src/core/server/kota-client.ts into src/modules/answer/client.ts; add a daemonClient(link) factory to the answer module that wires answer (POST /answer), log (GET /answers with URLSearchParams), and show (GET /answers/:id) through the typed DaemonTransport; move decodeAnswerHistoryListResult and decodeAnswerHistoryShowResult into the module; remove answerHttp, answerLogHttp, answerShowHttp and the inline answer handler closure from src/core/server/daemon-client.ts.
created_at: 2026-05-03T08:53:36.546Z
updated_at: 2026-05-03T09:18:38.324Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (commit `927dca24`, 2026-05-03), the audit migration
(commit `b6278cf1`, 2026-05-03), and the retract migration (commit
`8c212f0c`, 2026-05-03) have validated the `daemonClient(link)`
foundation pattern by moving four namespaces out of
`src/core/server/kota-client.ts` and `src/core/server/daemon-client.ts`
into their owning modules. 19 namespaces still have their TypeScript
shape and daemon-side wire code centralized in those two files.

The next-cleanest namespace that meaningfully extends the pattern is
`answer`:

- 3 methods (`answer(query, filter?)`, `log(filter?)`, `show(id)`) —
  the first migration to move a 3-method namespace, exercising mixed
  POST + GET wire methods in one factory.
- Already owned by a dedicated module under `src/modules/answer/`
  with its own `localClient(ctx)` factory, control routes
  (`answerControlRoutes`, registered against the daemon at `/answer`,
  `/answers`, and `/answers/:id`), provider layer
  (`answer-provider.ts`), history store (`answer-history-store.ts`),
  recall contributor (`recall-contributor.ts`), CLI (`cli.ts`), tool
  (`tool.ts`), system-prompt contributor (`system-prompt.ts`), and
  rendering (`render.ts`).
- ~98 lines of namespace-owned types in `kota-client.ts`
  (lines 681–803: `AnswerFilter`, `AnswerCitation`, `AnswerResult`,
  `AnswerHistoryRecord`, `AnswerHistoryEntry`,
  `AnswerHistoryListFilter`, `AnswerHistoryListResult`,
  `AnswerHistoryShowResult`, `AnswerClient`).
- ~85 lines of wire code in `daemon-client.ts` — `answerHttp`
  (lines 287–302) plus `answerLogHttp` (lines 304–321) plus
  `answerShowHttp` (lines 323–337) plus the two strict decoders
  `decodeAnswerHistoryListResult` (lines 182–210) and
  `decodeAnswerHistoryShowResult` (lines 212–240) plus the
  `isObject` helper used only by these two decoders (lines 242–244)
  plus the inline `answer: { ... }` closure on the central handler
  builder (lines 1880–1884) plus the
  `AnswerFilter`/`AnswerResult`/`AnswerHistoryListFilter`/
  `AnswerHistoryListResult`/`AnswerHistoryShowResult` imports.
- The wire code already POSTs JSON for `answer` and GETs JSON for
  `log`/`show`; the factory body collapses into one strict per-method
  call against the typed `DaemonTransport` link once the JSON body
  shape and URL serialization move alongside the rest of the namespace.
- The answer route handler in `src/modules/answer/routes.ts`, the
  history store in `answer-history-store.ts`, the provider in
  `answer-provider.ts`, the tool in `tool.ts`, the CLI in `cli.ts`,
  the renderer in `render.ts`, and the index module in `index.ts`
  currently import answer types from `#core/server/kota-client.js`.
  After the migration these imports point at the module-local
  `client.ts`, mirroring the doctor, audit, and retract pilots.

The migration extends the foundation pattern in three axes the prior
four pilots did not exercise:

1. **First multi-method-multi-verb namespace.** doctor (2 methods,
   POST), harnessParity (2 methods, POST + POST-with-args), audit
   (1 method, GET), and retract (1 method, POST) all use a single
   HTTP verb. Answer is the first migration to mix `POST /answer`
   with `GET /answers` and `GET /answers/:id` in one factory, proving
   the factory pattern composes across verbs.
2. **First path-parameter URL encoding.** `answer.show(id)` calls
   `GET /answers/${encodeURIComponent(id)}`. None of the prior four
   pilots encode an identifier into the URL path; this validates that
   the typed `DaemonTransport.requestStrict<T>` surface accepts a
   pre-encoded path segment without forcing each module to re-implement
   path safety.
3. **First strict response decoders moving alongside their
   namespace.** `decodeAnswerHistoryListResult` and
   `decodeAnswerHistoryShowResult` are answer-namespace-only validators
   for the daemon-up wire shape. Today they live in
   `src/core/server/daemon-client.ts` even though they encode the
   `AnswerHistoryListResult` and `AnswerHistoryShowResult` discriminated
   shapes that the answer module owns. Moving them to
   `src/modules/answer/client.ts` (or a sibling
   `daemon-decoders.ts`) puts the wire-shape validators in the same
   module as the types they validate; future namespaces with strict
   decoders adopt the same placement by precedent.

`AnswerFilter` aliases `RecallFilter` (and `AnswerResult` / `AnswerCitation`
/ `AnswerHistoryRecord` transitively reference `RecallHit` and
`RecallSource`). The `recall` namespace is not yet migrated, so the
new `src/modules/answer/client.ts` continues to import `RecallFilter`,
`RecallHit`, and `RecallSource` from `#core/server/kota-client.js`.
That cross-namespace dependency follows the established
"each migration moves only its own namespace types" rule and shifts on
its own once the recall namespace migrates in a later run.

## Desired Outcome

`answer` is the fifth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `AnswerClient`, `AnswerFilter`, `AnswerCitation`, `AnswerResult`,
  `AnswerHistoryRecord`, `AnswerHistoryEntry`,
  `AnswerHistoryListFilter`, `AnswerHistoryListResult`, and
  `AnswerHistoryShowResult` live in `src/modules/answer/client.ts`.
  The aggregate `KotaClient` interface in
  `src/core/server/kota-client.ts` imports `AnswerClient` from the
  module instead of declaring the types inline. The narrow
  `no-module-imports-in-core` allowlist (today: `server/kota-client.ts`)
  already covers the import; no allowlist edit is needed.
- `src/modules/answer/client.ts` imports `RecallFilter`, `RecallHit`,
  and `RecallSource` from `#core/server/kota-client.js` while the
  recall namespace remains centralized; no recall-side change is
  attempted in this task.
- `src/modules/answer/index.ts` exposes a `daemonClient(link)`
  factory parallel to its existing `localClient(ctx)` factory. The
  factory returns `{ answer: AnswerClient }` backed by three
  `link.requestStrict<T>` calls:
  - `answer(query, filter?)` → `POST /answer` with the JSON body
    `{ query, ...(filter && { filter }) }` and an `AnswerResult`
    response, byte-for-byte identical to today's `answerHttp`.
  - `log(filter?)` → `GET /answers${query?}` where `query` is the
    URL-encoded `URLSearchParams` for `limit` and `beforeId`,
    byte-for-byte identical to today's `answerLogHttp`. The
    response is decoded through the migrated
    `decodeAnswerHistoryListResult`.
  - `show(id)` → `GET /answers/${encodeURIComponent(id)}`,
    byte-for-byte identical to today's `answerShowHttp`. The
    response is decoded through the migrated
    `decodeAnswerHistoryShowResult`.
- The two strict decoders and their `isObject` helper move into the
  answer module as `src/modules/answer/daemon-decoders.ts` (or are
  inlined into `client.ts`, builder's choice — name and placement
  is a builder decision, but they must end up in the answer module
  alongside the types they validate).
- `src/core/server/daemon-client.ts` no longer carries `answerHttp`,
  `answerLogHttp`, `answerShowHttp`, the `decodeAnswerHistoryListResult`
  and `decodeAnswerHistoryShowResult` decoders, the `isObject` helper
  (if no other call site uses it), the inline
  `answer: { answer: ..., log: ..., show: ... }` closure on the
  core-side stub builder, the
  `AnswerFilter`/`AnswerResult`/`AnswerHistoryListFilter`/
  `AnswerHistoryListResult`/`AnswerHistoryShowResult` imports, or any
  other answer-specific code. Module-contributed handlers replace all
  of these the same way the doctor, harnessParity, audit, and retract
  migrations did.
- `src/modules/answer/index.ts`, `routes.ts`, `answer-history-store.ts`,
  `answer-provider.ts`, `answer-types.ts`, `tool.ts`, `cli.ts`,
  `render.ts`, and any related test files import answer types from
  `./client.js` (or `#modules/answer/client.js`) instead of
  `#core/server/kota-client.js`. Every other in-module consumer of
  these types follows the same shift.
- A new daemon-side factory unit test alongside the module
  (`src/modules/answer/daemon-client.test.ts`) exercises the wire
  shape against a mock `DaemonTransport`, mirroring `src/modules/
  doctor/daemon-client.test.ts`, `src/modules/harness-parity/
  daemon-client.test.ts`, `src/modules/guardrails-audit/
  daemon-client.test.ts`, and `src/modules/retract/
  daemon-client.test.ts`. The test pins (1) the factory exists,
  (2) `answer` routes through `requestStrict<T>` with a POST and a
  JSON body matching today's wire shape, (3) `log` builds the
  correct URLSearchParams query string for both empty and
  populated filters, (4) `show` URL-encodes the id segment correctly,
  (5) both `log` and `show` route their responses through the
  migrated decoders (a malformed payload throws), (6) the assembly
  satisfies coverage with the answer contribution, and (7) the
  assembly throws naming "answer" when the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"answer"`, and `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `answer` handler so tests that build a `DaemonControlClient` purely
  to exercise non-namespace daemon behavior continue to pass coverage.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes or
  wire shape — the `/answer`, `/answers`, and `/answers/:id` control
  routes keep their JSON body and query-string contracts exactly as
  the route handlers in `src/modules/answer/routes.ts` parse them.
  The public `/api/answer` route on the regular HTTP server is
  unrelated to this migration and must not be touched.
- The daemon-side handler uses `link.requestStrict<T>` through the
  typed `DaemonTransport`. It does not reach into `node:http`, the
  bearer token, or `.kota/daemon-control.json`. The JSON body shape
  for `POST /answer`, the URLSearchParams encoding for `GET /answers`,
  and the path-encoded id segment for `GET /answers/:id` match
  today's `answerHttp` / `answerLogHttp` / `answerShowHttp`
  byte-for-byte (no opportunistic field reshaping, no per-method
  body normalization).
- Strict decoders preserve their existing behavior. Moving
  `decodeAnswerHistoryListResult` and `decodeAnswerHistoryShowResult`
  out of `src/core/server/` does not relax their validation: the
  same fields are required, the same exceptions are thrown, and the
  same shape escapes the decoder. The `isObject` helper is colocated
  with the decoders (or inlined inside them); it does not reappear
  as a re-export from core.
- No legacy or compatibility surface. Delete `answerHttp`,
  `answerLogHttp`, `answerShowHttp`, the strict decoders, the
  `isObject` helper (if no other call site uses it; if it is shared
  with another decoder, leave it in core), the inline closure, the
  central type declarations, and the namespace-specific imports at
  the migration's edges as it completes; do not leave shims. The
  in-module import shift from `#core/server/kota-client.js` to
  `./client.js` is a hard cutover, not a parallel re-export.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `AnswerFilter` / `AnswerResult` /
  `AnswerHistoryRecord` / `AnswerHistoryEntry` /
  `AnswerHistoryListFilter` / `AnswerHistoryListResult` /
  `AnswerHistoryShowResult` declarations in `src/core/server/`.
  Existing assertions for the doctor, harnessParity, audit, and
  retract migrations stay green.
- The existing `no-module-imports-in-core` guard (under
  `src/core/agent-harness/no-module-imports-in-core.test.ts`)
  already allows `server/kota-client.ts` to import from
  `#modules/*`; no allowlist edit is needed for this migration.
  The sibling assertion that the allowlist itself stays load-bearing
  as namespaces continue to migrate must continue to hold.
- No protocol change. CLI behavior (`kota answer <query>`,
  `kota answer log`, `kota answer show <id>`), daemon-up vs
  daemon-down branching, web-client behavior against `/api/answer`,
  agent-tool behavior, dynamic-state contributor behavior, and
  `--json` output all continue to behave identically.
- Output continues to flow through `src/modules/rendering`. The
  answer module's existing rendering hooks (`render.ts`) are not
  part of this refactor.

## Done When

- `src/modules/answer/client.ts` exists and declares `AnswerClient`,
  `AnswerFilter`, `AnswerCitation`, `AnswerResult`,
  `AnswerHistoryRecord`, `AnswerHistoryEntry`,
  `AnswerHistoryListFilter`, `AnswerHistoryListResult`, and
  `AnswerHistoryShowResult`. `RecallFilter`, `RecallHit`, and
  `RecallSource` are imported from `#core/server/kota-client.js`
  (recall is not yet migrated). The `KotaClient` aggregate in
  `src/core/server/kota-client.ts` imports `AnswerClient` from this
  module.
- `src/modules/answer/index.ts` exposes `daemonClient(link)`
  parallel to `localClient(ctx)`, returning a single namespace
  contribution `{ answer: AnswerClient }` backed by `link.requestStrict<T>`.
- `decodeAnswerHistoryListResult` and `decodeAnswerHistoryShowResult`
  live in the answer module (in `client.ts` or in a sibling file)
  and are consumed by the new `daemonClient(link)` factory.
- `src/modules/answer/index.ts`, `routes.ts`,
  `answer-history-store.ts`, `answer-provider.ts`, `answer-types.ts`,
  `tool.ts`, `cli.ts`, `render.ts`, and every test file in the
  module import answer types from `./client.js`
  (not from `#core/server/kota-client.js`).
- `src/core/server/daemon-client.ts` no longer carries any
  `answer`-specific code: no `answerHttp`, no `answerLogHttp`, no
  `answerShowHttp`, no decoders, no inline
  `answer: { answer: ..., log: ..., show: ... }` closure on the
  core-side stub builder, no `AnswerFilter` / `AnswerResult` /
  `AnswerHistoryListFilter` / `AnswerHistoryListResult` /
  `AnswerHistoryShowResult` imports, and no other answer-specific
  helpers. The `isObject` helper is removed if no other decoder uses
  it.
- `src/modules/answer/daemon-client.test.ts` exists and covers the
  wire shape (POST body for `answer`, URLSearchParams encoding for
  `log`, path encoding for `show`), decoder routing for `log` and
  `show` (malformed payloads throw), coverage success, and coverage
  failure when the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"answer"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `answer` handler returning `{ ok: false, reason: "no_hits" }` for
  `answer`, `{ entries: [] }` for `log`, and
  `{ ok: false, reason: "not_found" }` for `show`.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace `AnswerFilter` /
  `AnswerResult` / `AnswerHistoryRecord` / `AnswerHistoryEntry` /
  `AnswerHistoryListFilter` / `AnswerHistoryListResult` /
  `AnswerHistoryShowResult` declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`answer-daemon-up.txt` / `answer-daemon-down.txt`) demonstrate
  parity for one read-then-mutate-then-read sequence
  (`kota answer "what is the retract seam"` → `kota answer log` →
  `kota answer show <id>`) showing the pre/post output is identical
  across modes. Answer is mostly read-mutate-mutate-read; the
  transcript exercises both the mutating `answer` arm (which appends
  to the persisted history store) and the read-back `log`/`show`
  arms explicitly.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-03T08-50-32-872Z-explorer-ix691l/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Six orthogonal preludes have already landed:

- `a0a5e3e2` — typed `DaemonTransport` plus non-namespace transport-
  method decoupling (the orthogonal prelude needed under all chunking
  answers).
- `203c76a6` — `daemonClient(link)` factory hook on `KotaModule`,
  `DaemonClientHandlers` assembly path on `DaemonControlClient`, and
  the per-namespace types guard
  (`kota-client-namespace-types-guard.test.ts`).
- `9f07ee87` — doctor pilot migrating the smallest namespace
  end-to-end through the new hook, validating the pattern.
- `927dca24` — harnessParity migration extending the pattern to a
  two-method namespace, confirming the per-namespace shape
  generalizes.
- `b6278cf1` — audit migration extending the pattern to a
  query-string-bodied namespace, confirming the shape generalizes
  across read-only `GET` namespaces.
- `8c212f0c` — retract migration extending the pattern to a
  JSON-body POST with discriminated request/result unions,
  confirming the shape generalizes across mutating namespaces.

`answer` is the next-cleanest namespace and the natural next pilot.
It extends the pattern in three axes the prior five pilots did not
exercise: (1) a multi-verb factory mixing POST and GET in one
namespace, (2) path-parameter URL encoding via
`encodeURIComponent`, and (3) namespace-owned strict response
decoders moving alongside their typed shapes. It is needed under
every chunking answer the owner can pick (a/b/c/d/unblock): the
answer namespace migrates exactly once regardless of whether the
parent lands in one cohesive run or fans out across follow-ups, so
this task does not commit the owner to any specific chunking
answer; it shrinks the parent task's scope by one full namespace
whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type and decoder moves out of
  `src/core/server/`, the new `daemonClient` factory on
  `answerModule`, the in-module import shift in `routes.ts`,
  `answer-history-store.ts`, `answer-provider.ts`, `answer-types.ts`,
  `tool.ts`, `cli.ts`, `render.ts`, `index.ts`, and the related
  tests, and the new daemon-side unit test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~98-line and ~85-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`answer-daemon-up.txt` / `answer-daemon-down.txt`) exercising
  one mutation-then-read-back sequence (`kota answer <query>` →
  `kota answer log` → `kota answer show <id>`) with identical
  output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced
  `AnswerFilter` / `AnswerResult` / `AnswerHistoryListResult`
  declaration in `src/core/server/`.
