---
id: task-migrate-owner-questions-daemon-control-routes-out-
title: Migrate /owner-questions daemon-control routes out of core via controlRoutes
status: ready
priority: p2
area: architecture
summary: Migrate the /owner-questions, /owner-questions/:id/answer, /owner-questions/:id/dismiss daemon-control endpoints from src/core/daemon/daemon-control-owner-questions.ts into the owner-questions module via KotaModule.controlRoutes, mirroring the approvals/history/voice migration pattern, and add an import-guard test refusing reintroduction.
created_at: 2026-04-25T06:29:16.834Z
updated_at: 2026-04-25T06:29:16.834Z
---

## Problem

`src/core/daemon/daemon-control.ts` still hard-codes the three
`/owner-questions*` control-plane routes (`GET /owner-questions`,
`POST /owner-questions/:id/answer`, `POST /owner-questions/:id/dismiss`)
and dispatches them through
`src/core/daemon/daemon-control-owner-questions.ts`. The
`owner-questions` module already owns the operator CLI subcommands and a
parallel public `/api/owner-questions*` route surface
(`src/modules/owner-questions/routes.ts`) that reaches
`getOwnerQuestionQueue()` directly. The two implementations duplicate the
same answer/dismiss/list logic — one routed through
`DaemonControlHandle.{listOwnerQuestions, answerOwnerQuestion,
dismissOwnerQuestion}` in core, the other reading the queue directly in
the module — and the only reason both exist is that the `controlRoutes`
seam did not exist when the daemon control handlers were written.

The `controlRoutes` seam landed with the voice migration (`aa59e6f8`),
was applied to history (`d8655ed0`), and was just applied to approvals
(`6011d701`). `src/core/daemon/AGENTS.md` now names the seam as the
recommended pattern for module-owned control-plane endpoints.
Owner-questions is the next clearest application: a module-owned domain
(`owner-questions`) with module-owned state (`OwnerQuestionQueue`),
module-owned CLI, but core-resident control-plane handlers and a
`DaemonControlHandle` shim that exists only to feed those handlers.

## Desired Outcome

The three `/owner-questions*` daemon-control endpoints are contributed by
the `owner-questions` module through `KotaModule.controlRoutes`, exactly
the way the approval-queue module contributes `/approvals*`, the history
module contributes `/history`, and the voice module contributes
`/voice/transcribe`, `/voice/synthesize`.
`src/core/daemon/daemon-control-owner-questions.ts` is deleted along with
its route-scope and dispatch entries in `daemon-control.ts`, and the
`DaemonControlHandle` owner-question methods (`listOwnerQuestions`,
`answerOwnerQuestion`, `dismissOwnerQuestion`) are removed from
`daemon-control-types.ts` and `daemon-handle.ts` once nothing in core
still needs them. The two parallel implementations collapse to one shared
module-side function family used by both the public
`/api/owner-questions*` routes and the new `/owner-questions*` control
routes. A new import-guard test refuses any future reintroduction of
`daemon-control-owner-questions*.ts` under `src/core/daemon/`. The wire
contract — bearer-token check, `read` scope on `GET /owner-questions`,
`control` scope on the two POSTs, `{ questions: PendingOwnerQuestion[] }`
/ `{ question: PendingOwnerQuestion }` response shapes,
`400 { error: "answer is required" }` on missing answer,
`404 { error: "Owner question not found or already resolved" }` on missing
or resolved id — is preserved and covered by a co-located
`DaemonControlServer`-based test in the owner-questions module, mirroring
the approval-queue, voice, and history modules' pattern. Route-key
collisions with built-ins or with another module's contribution still
throw at server construction.

## Constraints

- Use the existing `KotaModule.controlRoutes` seam. Do not introduce a
  parallel registration path or a shadow router.
- Preserve the existing route paths (`GET /owner-questions`,
  `POST /owner-questions/:id/answer`,
  `POST /owner-questions/:id/dismiss`), capability scopes (`read` for
  the GET, `control` for the two POSTs — match the current
  `BUILTIN_ROUTE_SCOPES` table in `daemon-control.ts`), bearer-token
  gating, status codes, and response shapes
  (`{ questions: PendingOwnerQuestion[] }` for list,
  `{ question: PendingOwnerQuestion }` for individual answer/dismiss,
  `400 { error: "answer is required" }` on missing answer,
  `404 { error: "Owner question not found or already resolved" }` on
  missing).
- Note the public-route handler answers via `queue.answer(id, answer,
  "http")` and dismisses via `queue.dismiss(id, reason, "http")`, while
  the current core handler routes through `handle.answerOwnerQuestion(id,
  answer)` and `handle.dismissOwnerQuestion(id, reason)`. Decide which
  source is authoritative and collapse to one path; do not leave both
  surfaces calling different methods on the same queue.
- The handler implementation must live once in the owner-questions
  module. Collapse the duplicated logic between `routes.ts`'s public
  `/api/owner-questions*` handlers and the new `controlRoutes` handlers
  into shared functions in the module; do not leave two bodies of the
  same logic in different files.
- Core must not import from `#modules/owner-questions/*`. The repo-wide
  guard in `src/core/agent-harness/no-module-imports-in-core.test.ts`
  already enforces this; do not weaken it. Add a dedicated import-guard
  test under `src/core/daemon/` (e.g.
  `no-daemon-control-owner-questions.test.ts`) that refuses any new
  `daemon-control-owner-questions*.ts` under `src/core/daemon/`, matching
  the approvals migration's `no-daemon-control-approvals.test.ts` and
  history migration's `no-daemon-control-history.test.ts` precedents.
- Remove `DaemonControlHandle.{listOwnerQuestions, answerOwnerQuestion,
  dismissOwnerQuestion}` and the corresponding `daemon-handle.ts`
  implementations once nothing in core still needs them. The module
  reaches `getOwnerQuestionQueue()` directly, which the current
  module-side `routes.ts` already does — so the handle shim should be
  deletable in full.
- Existing daemon-control client wrappers
  (`DaemonControlClient.{listOwnerQuestions, answerOwnerQuestion,
  dismissOwnerQuestion}` if present) and any callers in CLI/web/native
  paths must continue to work unchanged. Adjust internal wiring if
  needed, but do not change the wire contract.
- Update `src/core/daemon/AGENTS.md` and
  `src/modules/owner-questions/AGENTS.md` so each describes the new seam
  location truthfully. Remove `daemon-control-owner-questions.ts` from
  the "internal subdomains" enumeration in the daemon `AGENTS.md`;
  expand the owner-questions module `AGENTS.md` to name
  `/owner-questions*` as a `controlRoutes` contribution.

## Done When

- `src/core/daemon/daemon-control-owner-questions.ts` is deleted.
- `src/core/daemon/daemon-control.ts` no longer references any
  owner-questions route, scope, or handler — the file's import list,
  the `BUILTIN_ROUTE_SCOPES` table, and the dispatch switch are clean of
  `/owner-questions` entries.
- The owner-questions module declares the three routes through
  `KotaModule.controlRoutes` with the correct `capabilityScope` per
  method, and a co-located `DaemonControlServer`-based test exercises
  list/answer/dismiss end-to-end against the registered routes including
  the `read`/`control` capability-scope split, the missing-answer 400,
  and the missing-id 404.
- `daemon-handle.ts` and `daemon-control-types.ts` no longer carry the
  three owner-question methods on `DaemonControlHandle` once nothing in
  core still calls them.
- The two duplicated handler bodies (core's
  `daemon-control-owner-questions.ts` and module's `routes.ts`) have
  collapsed into one shared function family inside the module, sharing
  one queue-call path (`queue.answer` / `queue.dismiss` with the right
  source label, or whatever the chosen one path uses).
- An import-guard test rejects any new
  `daemon-control-owner-questions*.ts` under `src/core/daemon/` —
  modeled on `no-daemon-control-approvals.test.ts` and
  `no-daemon-control-history.test.ts`.
- The repo-wide `no-module-imports-in-core` guard still passes
  unmodified.
- `pnpm test` passes on the resulting branch with the new module-side
  test included.
- `src/core/daemon/AGENTS.md` and
  `src/modules/owner-questions/AGENTS.md` describe the migration's
  outcome accurately; no stale references to
  `daemon-control-owner-questions.ts` or the removed
  `DaemonControlHandle` owner-question methods remain anywhere in the
  repo.

## Source / Intent

The just-landed approvals migration
(`task-migrate-approvals-daemon-control-routes-out-of-cor`, commit
`6011d701`) followed the history migration (`d8655ed0`) and voice
migration (`aa59e6f8`), and updated `src/core/daemon/AGENTS.md` to name
the `controlRoutes` seam as the recommended pattern for module-owned
control-plane endpoints. Owner-questions is the next clearest
application: a module already owns the state, the CLI, and a parallel
public route surface, while the daemon control handlers still live in
core behind a `DaemonControlHandle` shim that exists only for that
purpose. Owner direction throughout the architecture initiative has been
"minimal core, module-first" — voice (`aa59e6f8`), Claude-SDK executor
(`f3a1b444`), architect mode (`85bb9176`), and the `HistoryProvider`
inversion (`8f12be9e`) all moved capability out of `src/core/`. This task
closes the gap before the remaining `daemon-control-*` files calcify
into core debt.

## Initiative

Minimal-core, module-first architecture: every module-owned capability
should also own its operator-facing surfaces, including HTTP control
routes. Each migration like this one shrinks the core boundary and makes
the seam discoverable as the recommended pattern for any future module
contributing control-plane endpoints. The remaining `daemon-control-*`
handlers in core (commands, metrics, push-tokens, sessions, webhook,
workflow) split into module-owned candidates and genuinely-core ones;
this task makes the next-clearest module-owned candidate visible in code
by completing it.

## Acceptance Evidence

- Diff showing `daemon-control-owner-questions.ts` deleted,
  `daemon-control.ts` cleaned of owner-question entries,
  `daemon-handle.ts` and `daemon-control-types.ts` cleaned of the three
  owner-question methods, the owner-questions module's `KotaModule`
  definition gaining `controlRoutes`, the duplicated `routes.ts` logic
  collapsed into one shared function family used by both surfaces, and
  the new import-guard test.
- New module-side `DaemonControlServer` test covering
  list/answer/dismiss including the `read`/`control` capability-scope
  split, the 400 missing-answer path, and the 404 missing-or-resolved
  path — pasted transcript or named test file in the run directory or
  PR body.
- `pnpm test` output (or relevant filtered subset) showing the new
  test green and the import-guard test green.
- Updated `src/core/daemon/AGENTS.md` and
  `src/modules/owner-questions/AGENTS.md` with the new seam wording.
