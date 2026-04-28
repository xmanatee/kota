---
id: task-add-a-unified-cross-store-retract-seam-mirroring-c
title: Add a unified cross-store retract seam mirroring capture so the agent can correct or remove prior captures
status: done
priority: p1
area: architecture
summary: Add a typed RetractProvider plus per-store RetractContributor protocol that mirrors the existing CaptureProvider/CaptureContributor pair, surface it as kota retract CLI, POST /retract daemon route, KotaClient.retract namespace, and a retract agent tool with module-owned conversational priming, so a per-user agent session can remove or supersede a prior capture by calling retract mid-conversation instead of leaving append-only contradictions in the stores.
created_at: 2026-04-28T10:20:51.878Z
updated_at: 2026-04-28T10:41:08.976Z
---

## Problem

The cross-store personal-assistant flow is now end-to-end through every
operator client and primed conversationally:

- `CaptureProvider` writes one note into memory / knowledge / tasks /
  inbox via a typed `CaptureContributor` registry (`805a6edf`).
- `RecallProvider` reads back across the same surfaces.
- `AnswerProvider` synthesizes cited answers from recall.
- `AnswerHistoryStore` persists every cited answer.
- `kota capture/recall/answer`, `POST /api/{capture,recall,answer}`,
  Telegram and Slack slash commands, web/macOS/mobile clients all
  consume the seams (~30 commits ending at `2f9b5b41`).
- A per-turn dynamic system-prompt block teaches the agent to call
  `capture`, `recall`, `answer` mid-conversation (`12c5e125`).

But the seam is **append-only**. The underlying stores do support
removal — `MemoryStore.delete(id)` (`src/modules/memory/store.ts:121`),
`KnowledgeStore.delete(id)` (`src/modules/knowledge/store.ts:196`), the
existing `pnpm kota task move <id> dropped` for normalized tasks, and a
plain file delete for inbox entries — but none of that is exposed
through one typed cross-store seam, no agent tool can call it, no
channel slash command surfaces it, and the system-prompt priming says
nothing about correction.

The owner-facing failure mode is concrete. A real personal-assistant
turn looks like:

1. User: "remember that I prefer green tea" → agent calls `capture` →
   memory entry minted.
2. User: "actually no, I prefer black coffee" → agent has no retract
   tool. Best case it appends a *contradicting* memory and lets recall
   surface both later, leaving the user to pick which one to trust.
   Worst case it free-styles a confirmation without persisting the
   correction at all.

Recall therefore has to disambiguate stale and current claims at read
time, the answer seam can cite an out-of-date memory as the grounding
source for a fresh "what does the user prefer?" question, and
answer-history records cited answers that were already wrong at the
moment of synthesis. Stores accumulate contradiction the seam itself
introduced, and there is no first-class operator surface — agent or
human — to retract a specific record by id.

The cross-store seam pattern that makes capture work — one provider,
one typed contributor union, one route handler, one agent tool, one
priming block per owning module — is exactly the right shape for
retract. Today the fact that retract is missing means the assistant's
memory of the user can only grow, never settle.

## Desired Outcome

- A new `RetractProvider` primitive with one in-process implementation
  in this module, accepting `{ target, id }` (or `{ target, slug }` for
  knowledge) and routing through a registry of typed
  `RetractContributor` adapters, mirroring `CaptureProvider` /
  `CaptureContributor`.
- A typed `RetractRecord` discriminated union mirroring `CaptureRecord`,
  one arm per supported store, carrying back the identifier(s) that
  were actually removed and any path metadata the operator needs to
  understand "what just happened" (e.g. tasks resolve to "moved to
  dropped", not raw filesystem deletes).
- A `RetractResult` envelope with the same strict shape as
  `CaptureResult`: `{ ok: true; record }` |
  `{ ok: false; reason: "no_contributors" }` |
  `{ ok: false; reason: "not_found"; target; id }` |
  `{ ok: false; reason: "contributor_failed"; target; message }`.
  No silent retries into a different store, no implicit cross-target
  search.
- One daemon-control route (`POST /retract`) plus its user-facing twin
  (`POST /api/retract`), both sharing one `createRetractRouteHandler`
  so the wire shape cannot drift.
- One `KotaClient.retract` namespace and one `kota retract --target
  <store> --id <id>` CLI subcommand rendered through
  `src/modules/rendering`. The CLI accepts `--id` for memory and tasks,
  `--slug` for knowledge, and a relative path for inbox; ambiguous
  invocations fail at parse time, not at the seam.
- One agent-callable tool (`retract`) contributed through the standard
  `KotaModule.tools` path. The tool wraps the same in-process
  `RetractProvider` the CLI / daemon route / KotaClient share, so an
  agent session running in any channel can correct a prior capture
  without an explicit `/retract` command. Tool descriptions cover the
  argument shape; the conversational trigger lives in the priming
  block (below).
- One per-turn dynamic system-prompt contributor (registered through
  `ctx.registerDynamicStateProvider` during `onLoad`, gated on
  effective tool policy), describing exactly when retract is the right
  call: a turn that explicitly contradicts a prior fact-shaped capture
  the agent already made. The block is short (≲10 lines) and emits the
  empty string when the tool is not admitted, matching the
  capture/recall/answer priming pattern.
- Tasks remain governed by their existing state machine. Retracting a
  task does **not** rm a tracked file; it routes through `pnpm kota
  task move <id> dropped` (or the equivalent in-process helper) so the
  state-machine invariants and `updated_at` frontmatter stay intact.
  The `RetractRecord` arm for tasks names the new state explicitly.
- This task lands the foundation seam only. Per-channel fan-out
  (Telegram `/retract`, Slack-channel `/retract`, web `RetractPanel`,
  macOS / mobile `RetractView`/`RetractScreen`, macOS `DaemonClient
  .retract`) lands later as honest single-task follow-ups, mirroring
  the capture-then-fan-out pattern. The explorer queue may seed those
  follow-ups in subsequent runs.

## Constraints

- One source of truth per surface. Provider, contributor protocol,
  route handler, CLI, tool, and priming block all live in
  `src/modules/capture/` (the seam already owns the inverse half) — or
  in a new `src/modules/retract/` if the capture module's surface area
  would otherwise blow past the file-size guideline. The choice
  between "extend capture" and "introduce retract" is up to the
  builder, but it must be exactly one of those two — no parallel
  registry under a third name.
- Reuse the existing `CaptureContributor` registry's discovery
  pattern: contributors register through the module's `onLoad` against
  the in-process provider. No core-side hardcoding of the contributor
  set.
- The cross-target identifier shape must be typed. Memory and inbox
  use string ids/paths, knowledge uses a slug, tasks use the
  task-id slug. Model these as distinct fields on the request and
  reject mismatched combinations at parse time.
- No silent target inference. The retract seam never guesses which
  store an id belongs to. The caller (operator, agent, slash command)
  always names the target.
- Tasks contributor must reuse the existing task-state-machine helper
  (`pnpm kota task move <id> dropped` or its in-process equivalent in
  `src/modules/repo-tasks`). It must not bypass the state machine,
  must not delete the file, and must not skip `updated_at` /
  `git mv` semantics. The `RetractRecord` for tasks names the
  resulting state.
- The retract seam refuses to act on a record id that does not exist
  in the named target. It never falls back to a different target. The
  envelope is `{ ok: false; reason: "not_found"; target; id }` —
  surfaced as a typed CLI exit and a typed tool result.
- The agent tool is high-risk under the standard `tool` protocol's
  capability/risk classification (it can permanently remove user
  data). Default supervision posture must require an approval gate or
  a clear reason in the operator-mode toggle, matching the existing
  guardrails for destructive actions. No new "always-allow" path.
- No edits to `src/core/agents/system-prompt.ts`. Priming is a
  module-owned per-turn dynamic state contributor, exactly as
  capture/recall/answer ship today.
- No fan-out edits in this task — explicitly out of scope. The CLI,
  daemon route, KotaClient namespace, agent tool, and priming are the
  full scope. Telegram, Slack, web, macOS, and mobile follow-ups are
  separate honest tasks.
- `pnpm typecheck` and `pnpm test` must pass.

## Done When

- `RetractProvider` plus `RetractContributor` protocol exist with one
  contributor each for memory, knowledge, tasks, and inbox; the
  contributor set is registered on `onLoad` through the same module
  boundary capture uses today.
- A focused unit test per contributor exercises both the success path
  (the underlying record is gone / dropped) and the `not_found` path
  against a real in-process store.
- A focused provider test exercises every `RetractResult` arm (`ok`,
  `no_contributors`, `not_found`, `contributor_failed`) with no mocks
  in the contributor layer.
- `kota retract` exists with strict argument parsing (`--target`
  required; `--id` / `--slug` / `--path` per target), produces the
  rendered envelope through `src/modules/rendering`, and has a CLI
  test that asserts the rendered transcript per arm.
- `POST /retract` and `POST /api/retract` exist, share one route
  handler, and are covered by `routes.test.ts` for every envelope arm.
- `KotaClient.retract` namespace exists and is reachable through both
  the daemon-backed and local clients, with a guard test that asserts
  the namespace is present.
- The `retract` agent tool is registered through `KotaModule.tools`,
  reuses the same in-process `RetractProvider`, declares the
  appropriate destructive risk classification, and renders its tool
  transcript byte-for-byte through `renderRetractResultPlain` (or the
  equivalent helper) so the slash-command, CLI, and tool surfaces
  cannot drift.
- A per-turn dynamic system-prompt contributor is registered during
  `onLoad`, gated on effective tool policy. A co-located test asserts
  (a) the conversational-pattern block appears when `retract` is
  admitted, (b) it does not appear when `retract` is excluded, and
  (c) it names both the tool and the conversational trigger
  ("explicit contradiction of a prior capture").
- A top-level integration test seeds memory and knowledge entries,
  runs the production `createRetractRouteHandler` against the real
  stores, asserts each arm of `RetractRecord` is reachable through
  the route, and asserts a follow-up `RecallProvider` query no longer
  surfaces the retracted record. The test also asserts that
  retracting a task routes through the state machine (the file ends
  up under `data/tasks/dropped/` with the matching status frontmatter
  rewrite), not a raw delete.
- Capture, retract, and (if needed) the recall module's `AGENTS.md`
  files document the new surface alongside the existing
  tool/CLI/route bullets, naming the contributor entry points and
  the agent-tool risk classification.
- `pnpm test` and `pnpm typecheck` pass on the project root.

## Source / Intent

Run `2026-04-28T10-16-03-963Z-explorer-t34mw2` (this run) identified
the gap during empty-queue exploration immediately after the
conversational priming task landed (`12c5e125 Prime conversational use
of capture/recall/answer via module-owned system prompt`). The full
write-then-read-then-cite-then-history personal-assistant flow now
ships in production code paths and is primed for conversational use,
but the flow is one-way: nothing the agent or operator can do retracts
a prior capture through one typed seam. The append-only seam directly
produces the contradiction-accumulation failure mode named in the
**Problem** section. Owner-facing claim: KOTA as a usable personal
assistant the operator's memory can settle into, not just grow into.

## Initiative

Cross-store personal-assistant seam — converting the just-shipped
write-side cycle (capture + agent priming) into a settle-able loop by
giving the agent and operator a typed correction surface symmetric to
capture. This is the architectural counterpart to "the agent uses
these tools mid-conversation": once the agent reaches for capture
automatically, the agent must also reach for retract automatically
when the user contradicts a prior capture. Without this, every
recall/answer turn after the first contradiction grounds itself in
stale data, and answer-history persists cited answers that were
already wrong at synthesis time.

## Acceptance Evidence

- The integration-test transcript described in **Done When**, captured
  under the run directory, showing each arm of `RetractRecord`
  reachable through `POST /retract` against real in-process stores
  with a follow-up recall query that no longer surfaces the retracted
  record.
- A `kota retract --target memory --id <id>` CLI transcript captured
  under the run directory showing the rendered success envelope plus
  a follow-up `kota recall` transcript proving the record is gone.
- A `kota retract --target tasks --id <task-id>` CLI transcript plus
  the resulting task file's location under `data/tasks/dropped/` (not
  a deleted file) and its rewritten `status: dropped` frontmatter.
- The co-located priming-contributor unit test asserting admitted-vs-
  excluded gating for the `retract` block, referenced from the run
  artifacts.
