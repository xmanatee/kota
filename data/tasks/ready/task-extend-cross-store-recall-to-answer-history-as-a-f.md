---
id: task-extend-cross-store-recall-to-answer-history-as-a-f
title: Extend cross-store recall to answer-history as a fifth contributor so prior cited answers ground new fact-shaped turns
status: ready
priority: p1
area: architecture
summary: Add searchAnswers to AnswerHistoryStore and register an answer-history RecallContributor (resolving the answer→recall cycle through a public RecallProvider registration seam) so cross-store recall surfaces the assistant's prior cited answers alongside knowledge/memory/history/tasks hits.
created_at: 2026-04-28T15:36:43.505Z
updated_at: 2026-04-28T15:36:43.505Z
---

## Problem

`src/modules/recall/index.ts` registers four contributors today —
`knowledge`, `memory`, `history`, `repo-tasks` — and the recall module's
own `AGENTS.md` documents the four-step "How a new store joins" surface
that has not been exercised since landing. The just-landed conversational
loop (commits `12c5e125` "Prime conversational use of capture/recall/
answer", `f34e3714` "Anchor retract through the conversational agent
loop") makes one consequence visible: a fact-shaped user turn that has
already been answered through `kota answer` is grounded in raw
knowledge/memory/history hits, never in the prior cited-answer envelope
that `DiskAnswerHistoryStore` already holds. The envelope is structured
(`AnswerHistoryRecord` carries the original query, the recall hits used,
the synthesized text, and the citation list), persisted under
`<projectStateRoot>/answer-history/`, and reachable by id — but invisible
to recall.

That breaks the conversational personal-assistant claim in two concrete
ways:

- A repeated question re-synthesizes from raw stores even when the agent
  has answered it cleanly before. The prior reply, which cost a real
  model call and earned an operator-visible citation set, is not
  surfaced as evidence on the next pass.
- The single most reusable artifact KOTA produces — a citation-tagged
  answer block — is the only first-party persisted store excluded from
  the cross-store seam that is supposed to enumerate every contributor.

There is a real architectural constraint to resolve along the way. The
`answer` module already depends on `recall` (it wraps `RecallProvider`
to gather evidence before synthesizing), so the existing
"register-from-recall's-onLoad" pattern does not apply: making `recall`
depend on `answer` would introduce a load-order cycle. The recall
module's `RecallProviderImpl` already exposes a `register()` API and the
`AGENTS.md` already states "`RecallProvider` itself enumerates
contributors at runtime through its `register()` API; nothing in core
hard-codes the contributor set". The clean move is to surface that
registration as a public seam (e.g. `getRecallProvider()` from the
provider registry, or a `recall:contributor` channel on the module
context) so the `answer` module registers its own adapter from its own
`onLoad`. That generalizes the contribution model — the answer-history
adapter lives in the answer module beside the rest of the answer code,
not in `recall/contributors.ts` reaching back across a dependency edge.

`AnswerHistoryStore` does not yet support search. It exposes
`appendAnswer`, `listAnswers(filter?)`, and `getAnswer(id)`. The
contributor needs a query-shaped read path returning ranked records, in
the same shape as `knowledge`/`memory`/`history`'s keyword fallbacks.

## Desired Outcome

- `RecallProvider.recall(query)` returns hits from a fifth source,
  `answer`, alongside the existing four. Each hit carries enough payload
  for a conversational turn to recognize and quote the prior answer:
  the original query, a clipped preview of the synthesized text or
  failure reason, the citation count, and `createdAt`.
- The `answer` module owns its recall adapter end-to-end. Its module
  code registers itself as a contributor in its own `onLoad`, beside
  the rest of the answer module. `recall/contributors.ts` does not gain
  a new helper that reaches across the dependency edge.
- `AnswerHistoryStore` gains a `searchAnswers(query, options)` method
  returning `AnswerHistoryRecord[]` ranked by relevance against the
  stored `query` field (and, if natural, the synthesized answer text).
  The implementation is keyword-shaped — same baseline as the
  knowledge/memory/history contributors' fallback path. No new
  embedding plumbing.
- The `RecallProvider` exposes a small, typed public registration seam
  the `answer` module uses. The seam has exactly one shape — adding a
  sixth contributor follows the same path. No second registration
  mechanism, no test-only override.
- The agent-loop integration coverage is extended so a fact-shaped turn
  that has a matching prior cited answer surfaces it as a recall hit.

## Constraints

- One mechanism. The new public `RecallProvider` registration seam
  replaces, not augments, the today-implicit "all contributors live in
  recall/contributors.ts" assumption. The four existing first-party
  contributors keep their current registration site if it stays in
  recall's onLoad, but the contract is now "any module can register a
  contributor from its own onLoad through the same seam".
- Strict types. `RecallSource`, `RecallHit`, and `RawRecallEntry` gain
  one literal arm and one matching payload arm. No optional-fields
  shortcut: the `answer` arm carries its own typed fields.
- The answer-history adapter's score is rank-derived, matching the
  existing convention for stores that lack native semantic scores
  (`rankScore(rank, topK)` in `recall/contributors.ts`). No second
  scoring strategy.
- `AnswerHistoryStore.searchAnswers` does not paginate beyond the
  caller's `topK`. It scans the existing newest-first id listing,
  decodes records lazily, and stops once it has the top-K matches —
  matching the lazy-decode pattern already in `listAnswers`.
- The recall module's daemon route, CLI, agent tool, and per-turn
  system-prompt block stay shape-compatible. Adding a fifth source must
  not break existing hits' rendering. `renderRecallHitsPlain` and the
  CLI table extend to handle the `answer` source explicitly.
- The existing four contributors keep their behavior identical. No
  side refactor of knowledge/memory/history/repo-tasks adapters in
  this task.
- No fan-out to web/Telegram/Slack/macOS/mobile in this task. Those
  surfaces consume `KotaClient.recall` and pick up the new source for
  free. Surface-level rendering polish for the new source belongs in
  follow-up tasks if needed.
- Stay strict on cycle handling. The `answer` module already declares
  `recall` in its `dependencies` and that stays unchanged. The recall
  module does not gain `answer` as a dependency.

## Done When

- `RecallSource` includes `"answer"` and `RecallHit` has a typed
  discriminated arm for it (with `query`, `preview`, `citationCount`,
  `createdAt`, and the result-shape `{ ok: true } | { ok: false; reason }`
  payload).
- `AnswerHistoryStore` (and its disk implementation) ship
  `searchAnswers(query, { topK })` returning ranked records using a
  keyword strategy matching the recall module's existing fallbacks.
  Co-located unit tests cover empty store, exact-substring match, and
  top-K trimming.
- The `answer` module registers an `answer` recall contributor through
  the new `RecallProvider` registration seam during its `onLoad`, and
  unregisters cleanly on `onUnload`. A unit test asserts that the
  registration is observable on `RecallProvider.contributors()` after
  the answer module has loaded against a real recall provider, and is
  absent after `onUnload`.
- An integration test under `src/` (extending
  `src/conversational-agent-tools.integration.test.ts` or its peer)
  seeds an answer-history record by calling `AnswerProviderImpl`
  end-to-end on one query, then issues a second `RecallProvider.recall`
  call with a similar query and asserts the prior answer appears as an
  `answer`-source hit alongside the existing knowledge/memory/history
  hits. The scoring contract — that the answer hit comes back as one
  of the top-K — is asserted, not the absolute score.
- `kota recall <query>` on a project with answer-history records
  renders an `answer` row in its table output (CLI fixture or transcript
  in the run directory shows this).
- `pnpm test` and `pnpm typecheck` are green on the project root.
- `src/modules/recall/AGENTS.md`, `src/modules/answer/AGENTS.md`, and
  `src/core/server/kota-client.ts`'s namespace comments stay aligned
  with the new contributor and the public registration seam. The recall
  AGENTS "How a new store joins" steps are rewritten to reflect the
  module-owned registration pattern, since the four existing
  contributors are now the historical case rather than the only path.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-28T15-33-44-283Z-explorer-7qhuof/` after the
conversational personal-assistant correction loop closed end-to-end:

- Capture/recall/answer/retract are uniformly fanned out across web,
  Telegram, Slack, macOS, and mobile (commits 805a6edf through
  0521e0be).
- The agent-loop is primed for capture/recall/answer (commit 12c5e125)
  and anchored for retract (commit f34e3714).

That makes the `answer` module's persisted output the only first-party
store the cross-store seam still excludes. The recent run direction has
been converting mechanically-available cross-store surfaces into
behaviorally-default conversational turns; surfacing prior cited answers
in recall is the next strategic move on that line, not a maintenance
chore. The architectural inversion (per-module registration through a
public seam) was already foreshadowed in the recall module's `AGENTS.md`
("`RecallProvider` itself enumerates contributors at runtime through its
`register()` API; nothing in core hard-codes the contributor set"); this
task makes that statement true at the boundary, not just inside the
recall module.

## Initiative

Cross-store personal-assistant seam. Recall should enumerate every
first-party persisted store, including the assistant's own prior cited
answers, so a conversational turn grounds in everything KOTA already
knows — not only the raw inputs (knowledge/memory/history/tasks) but
also the synthesized outputs the same loop has produced before. This
task closes the last seam-level gap on that initiative and lands the
public `RecallProvider` registration boundary the cross-store seam has
needed since the recall module landed.

## Acceptance Evidence

- Diff covering the new `RecallSource`/`RecallHit`/`RawRecallEntry`
  arm, the `searchAnswers` method on `AnswerHistoryStore`, the new
  public `RecallProvider` registration seam, the answer module's
  contributor registration in `onLoad`/`onUnload`, the integration
  test extension, and the AGENTS.md updates.
- Test output showing the new unit and integration tests pass and
  the existing recall/answer suites remain green.
- A `kota recall <query>` transcript captured under the run directory
  showing an `answer`-source hit appearing alongside the existing
  four sources for a query that has a matching prior cited answer.
- A short note on the run directory recording the registration-seam
  shape chosen (e.g. `getRecallProvider()` exposed through the
  provider registry vs a `ctx.registerRecallContributor` channel on
  the module context) so the next contributor follows the same path.
