---
id: task-migrate-the-ownerquestions-kotaclient-namespace-en
title: Migrate the ownerQuestions KotaClient namespace end-to-end through the daemonClient(link) factory hook (foundation pilot follow-up)
status: ready
priority: p1
area: architecture
summary: Move OwnerQuestionsClient interface, OwnerQuestionListFilter, OwnerQuestionsListResult, and OwnerQuestionMutateResult from src/core/server/kota-client.ts into src/modules/owner-questions/client.ts; add a daemonClient(link) factory that wires list (GET /owner-questions), answer (POST /owner-questions/:id/answer), and dismiss (POST /owner-questions/:id/dismiss) through the typed DaemonTransport; remove answerOwnerQuestionHttp, dismissOwnerQuestionHttp, listOwnerQuestionsHttp, the inline ownerQuestions handler closure, and the OwnerQuestionStatus/PendingOwnerQuestion/OwnerQuestionMutateResult imports from src/core/server/daemon-client.ts.
created_at: 2026-05-03T09:31:40.245Z
updated_at: 2026-05-03T09:31:40.245Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (commit `927dca24`, 2026-05-03), the audit migration
(commit `b6278cf1`, 2026-05-03), the retract migration (commit
`8c212f0c`, 2026-05-03), and the answer migration (commit `eb392cd1`,
2026-05-03) have validated the `daemonClient(link)` foundation pattern
by moving five namespaces out of `src/core/server/kota-client.ts` and
`src/core/server/daemon-client.ts` into their owning modules. 22
namespaces still have their TypeScript shape and daemon-side wire code
centralized in those two files (`kota-client.ts` is 1674 lines,
`daemon-client.ts` is 2107 lines, both still well over the 300-line
guideline).

The next-cleanest namespace that meaningfully extends the pattern is
`ownerQuestions`:

- 3 methods (`list(filter?)`, `answer(id, answer)`, `dismiss(id, reason?)`)
  — same method count as the answer pilot but with two POST mutations
  plus one GET, where the answer pilot was POST + GET-list + GET-show.
- Already owned by a dedicated module under `src/modules/owner-questions/`
  with its own `localClient(ctx)` factory (in `index.ts`), HTTP routes
  (`ownerQuestionRoutes`, registered against the regular HTTP server at
  `/api/owner-questions`, `/api/owner-questions/:id/answer`, and
  `/api/owner-questions/:id/dismiss`), control routes
  (`ownerQuestionControlRoutes`, registered against the daemon control
  server at `/owner-questions`, `/owner-questions/:id/answer`, and
  `/owner-questions/:id/dismiss`), and CLI (`cli.ts`).
- ~12 lines of namespace-owned types in `kota-client.ts`
  (lines 400–411: `OwnerQuestionListFilter`, `OwnerQuestionsListResult`,
  `OwnerQuestionMutateResult`) plus the 5-line `OwnerQuestionsClient`
  interface (lines 939–943).
- ~78 lines of wire code in `daemon-client.ts`:
  - `answerOwnerQuestionHttp` (lines 847–872): POST with JSON body
    `{ answer }` and 404 → discriminated `{ ok: false, reason: "not_found" }`
    handling.
  - `dismissOwnerQuestionHttp` (lines 874–899): POST with conditional
    JSON body `JSON.stringify(reason !== undefined ? { reason } : {})`.
  - `listOwnerQuestionsHttp` (lines 901–915): GET with optional
    `?status=` query string.
  - The inline `ownerQuestions: { list: ..., answer: ..., dismiss: ... }`
    closure on the central handler builder (lines 1647–1654) that
    converts `listOwnerQuestionsHttp`'s `null` fallback into
    `{ questions: [] }`.
  - The `OwnerQuestionStatus` / `PendingOwnerQuestion` imports from
    `#core/daemon/owner-question-queue.js` (lines 15–18) and the
    `OwnerQuestionMutateResult` import from `./kota-client.js` (line 65).
- The wire code already POSTs JSON for `answer` and `dismiss` and GETs
  JSON for `list`; the factory body collapses into one strict per-method
  call against the typed `DaemonTransport` link once the JSON body
  shape, the optional-query encoding, and the path-encoded id segments
  move alongside the rest of the namespace.
- The owner-questions CLI in `src/modules/owner-questions/cli.ts` is the
  primary in-module consumer of `OwnerQuestionsClient`; the routes file
  imports `OwnerQuestionStatus` and `PendingOwnerQuestion` from
  `#core/daemon/owner-question-queue.js` (the daemon-shared queue
  primitive), which stays in core. After the migration the in-module
  imports of `OwnerQuestionsClient` / `OwnerQuestionListFilter` /
  `OwnerQuestionsListResult` / `OwnerQuestionMutateResult` shift from
  `#core/server/kota-client.js` to the new module-local `client.ts`,
  mirroring the doctor, harnessParity, audit, retract, and answer
  pilots.

The migration extends the foundation pattern in three axes the prior
five pilots did not exercise:

1. **First two POST routes sharing an id-bearing path stem.** The answer
   pilot's `show(id)` was `GET /answers/${encodeURIComponent(id)}` — one
   path-encoded route in the namespace. ownerQuestions has two
   POST routes that both encode the id segment
   (`POST /owner-questions/${encodeURIComponent(id)}/answer` and
   `POST /owner-questions/${encodeURIComponent(id)}/dismiss`), proving
   the typed `DaemonTransport.requestStrict<T>` surface composes when
   multiple methods on the same namespace share an id-bearing path stem.
2. **First optional body field with conditional serialization.**
   `dismiss(id, reason?)` builds its POST body as
   `JSON.stringify(reason !== undefined ? { reason } : {})` — the body
   shape varies based on whether the optional argument is present. None
   of the prior five pilots exercised conditional body shaping; this
   validates that the factory pattern composes with optional fields
   without forcing each module to invent its own body-builder helper.
3. **First payload-bearing discriminated mutate result.** The retract
   pilot's mutate result was
   `{ ok: true } | { ok: false; reason: "..." }` — a payload-free ok
   arm. The doctor `fix` mutate result was similar. ownerQuestions has
   `{ ok: true; question: PendingOwnerQuestion } | { ok: false; reason: "not_found" }`
   — the ok arm carries a typed payload (`question`) that the CLI uses
   to render attribution (`resolutionSource`, `resolvedAt`). This is
   the first migration where the new factory composes a discriminated
   union with a payload-bearing ok arm, establishing the precedent for
   namespaces that return resolved-state objects on mutation success
   (e.g. future approvals, sessions follow-ons).

`OwnerQuestionStatus` and `PendingOwnerQuestion` come from
`#core/daemon/owner-question-queue.js`, the daemon-shared queue
primitive that is core. The new `src/modules/owner-questions/client.ts`
continues to import these types from `#core/daemon/owner-question-queue.js`
exactly as `routes.ts` already does. That cross-namespace dependency
follows the established "each migration moves only its own namespace
types" rule and stays unchanged whether or not the owner-question queue
itself ever moves out of core (it should stay; the queue is a daemon
runtime primitive, not a module-owned shape).

## Desired Outcome

`ownerQuestions` is the sixth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `OwnerQuestionsClient`, `OwnerQuestionListFilter`,
  `OwnerQuestionsListResult`, and `OwnerQuestionMutateResult` live in
  `src/modules/owner-questions/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports
  `OwnerQuestionsClient` from the module instead of declaring the
  types inline. The narrow `no-module-imports-in-core` allowlist
  (today: `server/kota-client.ts`) already covers the import; no
  allowlist edit is needed.
- `src/modules/owner-questions/client.ts` imports `OwnerQuestionStatus`
  and `PendingOwnerQuestion` from `#core/daemon/owner-question-queue.js`
  (the daemon-shared queue primitive); no queue-side change is
  attempted in this task.
- `src/modules/owner-questions/index.ts` exposes a `daemonClient(link)`
  factory parallel to its existing `localClient(ctx)` factory. The
  factory returns `{ ownerQuestions: OwnerQuestionsClient }` backed by
  three `link.requestStrict<T>` calls:
  - `list(filter?)` → `GET /owner-questions${query?}` where `query` is
    `?status=${encodeURIComponent(filter.status)}` when `filter?.status`
    is set, byte-for-byte identical to today's `listOwnerQuestionsHttp`.
    The response shape is `{ questions: PendingOwnerQuestion[] }`. The
    new factory does **not** silently swallow HTTP errors into
    `{ questions: [] }` the way today's central closure does — strict
    transport errors propagate through `requestStrict<T>` per the
    established foundation pattern.
  - `answer(id, answer)` → `POST /owner-questions/${encodeURIComponent(id)}/answer`
    with the JSON body `{ answer }`, byte-for-byte identical to today's
    `answerOwnerQuestionHttp`. The 404-to-`{ ok: false, reason: "not_found" }`
    discriminant is preserved by the factory; HTTP 5xx and network
    errors throw via `requestStrict<T>` rather than masquerading as
    `not_found`. The 200 response shape is decoded as
    `{ question: PendingOwnerQuestion }` and surfaced as
    `{ ok: true, question }`.
  - `dismiss(id, reason?)` → `POST /owner-questions/${encodeURIComponent(id)}/dismiss`
    with the conditional JSON body
    `JSON.stringify(reason !== undefined ? { reason } : {})`,
    byte-for-byte identical to today's `dismissOwnerQuestionHttp`.
    Same 404 / 5xx / 200 disposition as `answer`.
- `src/core/server/daemon-client.ts` no longer carries
  `answerOwnerQuestionHttp`, `dismissOwnerQuestionHttp`,
  `listOwnerQuestionsHttp`, the inline
  `ownerQuestions: { list: ..., answer: ..., dismiss: ... }` closure on
  the core-side stub builder, the
  `OwnerQuestionStatus`/`PendingOwnerQuestion` imports from
  `#core/daemon/owner-question-queue.js`, the `OwnerQuestionMutateResult`
  import from `./kota-client.js`, or any other ownerQuestions-specific
  code. Module-contributed handlers replace all of these the same way
  the doctor, harnessParity, audit, retract, and answer migrations did.
- `src/modules/owner-questions/index.ts`, `cli.ts`, and any related
  test files import ownerQuestions client types from `./client.js`
  (or `#modules/owner-questions/client.js`) instead of
  `#core/server/kota-client.js`. Every other in-module consumer of
  these types follows the same shift. `routes.ts` continues to import
  `OwnerQuestionStatus` and `PendingOwnerQuestion` from
  `#core/daemon/owner-question-queue.js` (no change needed).
- A new daemon-side factory unit test alongside the module
  (`src/modules/owner-questions/daemon-client.test.ts`) exercises the
  wire shape against a mock `DaemonTransport`, mirroring `src/modules/
  doctor/daemon-client.test.ts`, `src/modules/harness-parity/
  daemon-client.test.ts`, `src/modules/guardrails-audit/
  daemon-client.test.ts`, `src/modules/retract/daemon-client.test.ts`,
  and `src/modules/answer/daemon-client.test.ts`. The test pins
  (1) the factory exists, (2) `list` builds the correct query string
  for absent and present `filter.status` values and routes through
  `requestStrict<T>` with a GET, (3) `answer` routes through
  `requestStrict<T>` with a POST, URL-encodes the id segment, and
  serializes the JSON body `{ answer }` exactly,
  (4) `dismiss` routes through `requestStrict<T>` with a POST,
  URL-encodes the id segment, and serializes `{}` when `reason` is
  absent and `{ reason }` when present, (5) a `requestStrict<T>` call
  that surfaces a 404 transforms into
  `{ ok: false, reason: "not_found" }` for both `answer` and `dismiss`
  (and any other `requestStrict<T>` failure throws — i.e. is not
  silently coerced into `not_found`), (6) a 200 response body
  `{ question: PendingOwnerQuestion }` surfaces as
  `{ ok: true, question }`, (7) the assembly satisfies coverage with
  the ownerQuestions contribution, and (8) the assembly throws naming
  "ownerQuestions" when the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"ownerQuestions"`, and `buildMigratedNamespaceTestStubs()`
  in `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `ownerQuestions` handler so tests that build a `DaemonControlClient`
  purely to exercise non-namespace daemon behavior continue to pass
  coverage.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes or
  wire shape — the `/owner-questions`, `/owner-questions/:id/answer`,
  and `/owner-questions/:id/dismiss` control routes keep their JSON
  body and query-string contracts exactly as the route handlers in
  `src/modules/owner-questions/routes.ts` parse them. The public
  `/api/owner-questions/*` routes on the regular HTTP server are
  unrelated to this migration and must not be touched.
- The daemon-side handler uses `link.requestStrict<T>` through the
  typed `DaemonTransport`. It does not reach into `node:http`, the
  bearer token, or `.kota/daemon-control.json`. The optional
  `?status=` query string for `GET /owner-questions`, the JSON body
  shape for `POST /owner-questions/:id/answer`, the conditional JSON
  body shape for `POST /owner-questions/:id/dismiss`, and the
  path-encoded id segments match today's `listOwnerQuestionsHttp` /
  `answerOwnerQuestionHttp` / `dismissOwnerQuestionHttp`
  byte-for-byte (no opportunistic field reshaping, no per-method body
  normalization).
- Strict error handling. Today's central inline closure converts a
  `null` from `listOwnerQuestionsHttp` (HTTP error) into
  `{ questions: [] }`, and the `*Http` mutation helpers convert any
  thrown non-HTTP error into `{ ok: false, reason: "not_found" }`. The
  new factory does not preserve those silent-failure paths: HTTP 4xx
  outside of 404 and HTTP 5xx and network failures throw via
  `requestStrict<T>`. The 404-to-`{ ok: false, reason: "not_found" }`
  discriminant is preserved (it is the documented contract of the
  mutation methods), but anything else surfaces as a thrown error per
  the foundation pattern's "fail loudly on transport errors" stance.
  The CLI surface is unaffected: `kota owner-question` already lets
  thrown errors propagate to the renderer rather than translating them
  to empty-state output, so this is a strict improvement that aligns
  the daemon-up path with the local path.
- No legacy or compatibility surface. Delete `answerOwnerQuestionHttp`,
  `dismissOwnerQuestionHttp`, `listOwnerQuestionsHttp`, the inline
  closure, the central type declarations, and the namespace-specific
  imports at the migration's edges as it completes; do not leave shims.
  The in-module import shift from `#core/server/kota-client.js` to
  `./client.js` is a hard cutover, not a parallel re-export.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `OwnerQuestionListFilter` / `OwnerQuestionsListResult`
  / `OwnerQuestionMutateResult` declarations in `src/core/server/`.
  Existing assertions for the doctor, harnessParity, audit, retract,
  and answer migrations stay green.
- The existing `no-module-imports-in-core` guard (under
  `src/core/agent-harness/no-module-imports-in-core.test.ts`)
  already allows `server/kota-client.ts` to import from
  `#modules/*`; no allowlist edit is needed for this migration.
  The sibling assertion that the allowlist itself stays load-bearing
  as namespaces continue to migrate must continue to hold.
- No protocol change. CLI behavior (`kota owner-question list`,
  `kota owner-question answer <id> <answer>`,
  `kota owner-question dismiss <id> [reason]`,
  `kota owner-question history`), daemon-up vs daemon-down branching,
  and `--json` output all continue to behave identically modulo the
  strict-error change above (which only affects error paths the CLI
  already propagates).
- Output continues to flow through `src/modules/rendering`. The
  owner-questions module's existing CLI rendering is not part of this
  refactor.

## Done When

- `src/modules/owner-questions/client.ts` exists and declares
  `OwnerQuestionsClient`, `OwnerQuestionListFilter`,
  `OwnerQuestionsListResult`, and `OwnerQuestionMutateResult`.
  `OwnerQuestionStatus` and `PendingOwnerQuestion` are imported from
  `#core/daemon/owner-question-queue.js` (the daemon-shared queue
  primitive). The `KotaClient` aggregate in
  `src/core/server/kota-client.ts` imports `OwnerQuestionsClient` from
  this module.
- `src/modules/owner-questions/index.ts` exposes `daemonClient(link)`
  parallel to `localClient(ctx)`, returning a single namespace
  contribution `{ ownerQuestions: OwnerQuestionsClient }` backed by
  `link.requestStrict<T>`.
- `src/modules/owner-questions/index.ts`, `cli.ts`, and every test
  file in the module that references the client types import them
  from `./client.js` (not from `#core/server/kota-client.js`).
  `routes.ts` continues to import `OwnerQuestionStatus` and
  `PendingOwnerQuestion` from `#core/daemon/owner-question-queue.js`.
- `src/core/server/daemon-client.ts` no longer carries any
  ownerQuestions-specific code: no `answerOwnerQuestionHttp`, no
  `dismissOwnerQuestionHttp`, no `listOwnerQuestionsHttp`, no inline
  `ownerQuestions: { list: ..., answer: ..., dismiss: ... }` closure
  on the core-side stub builder, no `OwnerQuestionStatus` /
  `PendingOwnerQuestion` imports from
  `#core/daemon/owner-question-queue.js`, no
  `OwnerQuestionMutateResult` import from `./kota-client.js`, and no
  other ownerQuestions-specific helpers.
- `src/modules/owner-questions/daemon-client.test.ts` exists and
  covers the wire shape (query-string encoding for `list`, POST body
  for `answer`, conditional POST body and path encoding for
  `dismiss`), 404-to-`not_found` discrimination for both mutations,
  successful 200 decoding, coverage success, and coverage failure
  when the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"ownerQuestions"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `ownerQuestions` handler returning `{ questions: [] }` for `list`,
  `{ ok: false, reason: "not_found" }` for `answer`, and
  `{ ok: false, reason: "not_found" }` for `dismiss`.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace
  `OwnerQuestionListFilter` / `OwnerQuestionsListResult` /
  `OwnerQuestionMutateResult` declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`owner-questions-daemon-up.txt` /
  `owner-questions-daemon-down.txt`) demonstrate parity for one
  list-then-mutate-then-list sequence
  (`kota owner-question list` → `kota owner-question dismiss <id>` →
  `kota owner-question list --status all`) showing the pre/post
  output is identical across modes. The transcript exercises both
  the read-only `list` arm and the mutating `dismiss` arm explicitly;
  `answer` is exercised on the same id (or on a freshly seeded
  pending question) so all three methods appear in at least one
  transcript.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-03T09-27-17-187Z-explorer-xorlh1/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Seven orthogonal preludes have already landed:

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
- `eb392cd1` — answer migration extending the pattern to a
  multi-verb namespace mixing POST + GET + GET-with-path-id, with
  namespace-owned strict response decoders.

`ownerQuestions` is the next-cleanest namespace and the natural next
pilot. It extends the pattern in three axes the prior six pilots did
not exercise: (1) two POST routes sharing an id-bearing path stem in
one namespace, (2) optional body field with conditional serialization
based on whether an optional argument is present, and (3) a
payload-bearing discriminated mutate result
(`{ ok: true; question: PendingOwnerQuestion } | { ok: false; reason: "not_found" }`)
where the ok arm carries a typed payload — the precedent for future
namespaces (approvals, sessions follow-ons) that return resolved-state
objects on mutation success. It is needed under every chunking answer
the owner can pick (a/b/c/d/unblock): the ownerQuestions namespace
migrates exactly once regardless of whether the parent lands in one
cohesive run or fans out across follow-ups, so this task does not
commit the owner to any specific chunking answer; it shrinks the
parent task's scope by one full namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type moves out of `src/core/server/`, the
  new `daemonClient` factory on `ownerQuestionsModule`, the in-module
  import shift in `index.ts`, `cli.ts`, and the related tests, and
  the new daemon-side unit test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~17-line and ~78-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`owner-questions-daemon-up.txt` /
  `owner-questions-daemon-down.txt`) exercising one
  list-then-mutate-then-list sequence
  (`kota owner-question list` → `kota owner-question dismiss <id>` →
  `kota owner-question list --status all`) with identical output
  across modes; `answer` exercised on the same id or a freshly seeded
  pending question.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced
  `OwnerQuestionListFilter` / `OwnerQuestionsListResult` /
  `OwnerQuestionMutateResult` declaration in `src/core/server/`.
