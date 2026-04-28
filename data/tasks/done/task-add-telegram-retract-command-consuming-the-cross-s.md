---
id: task-add-telegram-retract-command-consuming-the-cross-s
title: Add Telegram /retract command consuming the cross-store retract seam
status: done
priority: p2
area: modules
summary: Land /retract on the Telegram channel against POST /retract so an operator can correct or remove a prior capture from chat, mirroring the just-shipped retract seam plus the existing /capture fan-out pattern.
created_at: 2026-04-28T10:57:37.254Z
updated_at: 2026-04-28T11:11:36.190Z
---

## Problem

The cross-store retract seam landed at commit `546cacab` with a
`RetractProvider` primitive, a `RetractContributor` registry binding
memory / knowledge / tasks / inbox removers, a `POST /retract` daemon
route plus its `POST /api/retract` user-facing twin, the
`KotaClient.retract` namespace, the `kota retract` CLI subcommand, the
agent-callable `retract` tool (`dangerous` risk), and the per-turn
conversational priming block. The seam intentionally shipped without
any channel adoption — `src/modules/retract/AGENTS.md` explicitly
records that "Telegram, web, macOS, and mobile adoption land later as
their own honest single-task follow-ups, matching the capture+recall+
answer pattern." It also shipped without the four-channel parity chain
that `/capture` already has on Telegram, web, macOS, mobile, and the
Slack channel.

The Telegram bot already exposes `/recall`, `/answer`, `/answer-log`,
`/answer-show`, and `/capture` plus the four `/capture-to-<store>`
twins as the unified read-side and write-side cross-store entries. What
it does not yet expose is the *correction-side* entry — a way to
remove or supersede a prior capture from chat without leaving Telegram
to run `kota retract --target ... --id ...` from the CLI. The friction
this hides is real: most stale memory entries and miscaptured notes
get noticed in conversation, where the operator already has the
identifier in front of them. Today the operator either tolerates the
stale record or context-switches to a terminal.

The retract seam differs from capture in one structural way that this
task must respect: it has no classifier. `RetractRequest` requires
`target` plus a target-specific identifier (`memory.id`,
`knowledge.slug`, `tasks.id`, `inbox.path`). There is no
"infer the target" arm. The chat surface therefore cannot expose an
unguided `/retract <text>` primary in the way `/capture <text>` works;
every chat invocation must name a target up front.

## Desired Outcome

- The Telegram channel exposes four explicit-target commands that map
  one-to-one onto `RetractTarget` and the per-target arms of
  `RetractRequest`:
  - `/retract-memory <id>`
  - `/retract-knowledge <slug>`
  - `/retract-tasks <id>`
  - `/retract-inbox <path>`
  All four are registered alongside the existing `/recall`, `/answer`,
  `/capture`, and `/capture-to-<store>` commands and gated by the same
  chat allowlist.
- An optional umbrella `/retract` command, if registered, exists only
  to print a fixed help body listing the four explicit-target
  subcommands and their identifier shapes. It does not call the seam
  and does not attempt classification — there is no classifier.
- Each target command is a thin wrapper over
  `ctx.client.retract.retract({ target, ... })` with the per-target
  identifier extracted from the slash-command argument. No second
  classifier, no parallel routing logic, no per-store fan-out inside
  the Telegram module. The seam already owns dispatch, the typed
  `not_found` arm, and contributor-failure isolation.
- The reply renders the typed `RetractResult` envelope exhaustively:
  - `ok: true` → a one-line confirmation naming the resolved store
    plus the typed identifier the contributor returned, including the
    tasks-arm "moved to dropped" wording (not "deleted") that the
    seam's `RetractTasksRecord` already encodes. The renderer reuses
    `renderRetractResultPlain` (or its existing equivalent) from
    `src/modules/retract/render.ts`.
  - `ok: false; reason: "no_contributors"` → a fixed body explaining
    that the seam is unconfigured (zero contributors registered, or
    the requested target is not registered).
  - `ok: false; reason: "not_found"` → a fixed body that names the
    target and the supplied identifier verbatim, distinct from
    `no_contributors`. The Telegram layer does not search other
    targets on `not_found`; the seam contract forbids that fallback.
  - `ok: false; reason: "contributor_failed"` → a fixed body that
    surfaces the target plus the contributor's verbatim error message.
- Empty / whitespace-only argument is treated as an operator error
  before the seam is called, with a fixed body that points back to the
  per-target usage. The Telegram handler refuses to call retract with
  an empty identifier.
- `/recall`, `/answer`, `/capture`, and the `/capture-to-<store>`
  twins stay as-is. `/retract-<store>` is additive — it gives the
  symmetric correction-side entry without altering the read-side or
  write-side surfaces.

## Constraints

- One mechanism. The four commands consume the existing `retract`
  namespace on `KotaClient`; they do not introduce a second router, a
  second classifier path, a second contributor registry, or a per-
  store fan-out helper. The four explicit-target commands share one
  internal handler that resolves the target verbatim from the command
  name before dispatching; they share rendering and failure handling.
- Strict typed protocols. The renderer consumes the seam's
  discriminated `RetractResult` union exhaustively (`ok: true` and
  the three `ok: false` reasons) with no `default` branch. Each
  `RetractRecord` arm is rendered by direct switch on `target` with
  exhaustive coverage. No optional fields, no silent fallbacks, no
  per-store nullability shims in the Telegram layer.
- The Telegram module must not import from `#modules/retract` directly
  for runtime behavior beyond the typed `KotaClient.retract` namespace
  it consumes. If the existing `renderRetractResultPlain` helper from
  `src/modules/retract/render.ts` is reused, declare `retract` in the
  Telegram `KotaModule.dependencies` array. Per the cross-module
  import rule in `src/modules/AGENTS.md`, this declaration is
  enforced by `src/core/modules/module-deps.test.ts` at load time.
- Chat-allowlist gating only. Do not gate `/retract-<store>` behind
  quiet hours — retract is an operator-initiated correction, not a
  notification. Matches `/capture` and `/recall`.
- No confirmation prompt step. Retract is `dangerous` at the agent-
  tool layer because it bypasses confirmation, but the chat surface
  is invoked by the operator directly with an explicit identifier; a
  separate "are you sure?" Telegram round-trip would add friction
  without adding safety, since the operator has already typed the
  exact identifier. The seam's `not_found` arm already prevents
  silent removal of an unrelated record. If a future task adds a
  confirmation pattern, it lands across all surfaces uniformly, not
  as a Telegram-only twist.
- Cost signals do not flow back to the operator chat reply. Match the
  existing repo standing rule.
- No legacy or compatibility shim. The four `/retract-<store>`
  commands plus the optional umbrella help command are the only
  Telegram surfaces for cross-store retract. The reply formats above
  are the only formats; no opt-in flag, no v2 path, no inline
  `/retract memory: <id>` modifier syntax, no legacy `/forget` alias.

## Done When

- The Telegram bot command set registers four new commands —
  `/retract-memory`, `/retract-knowledge`, `/retract-tasks`,
  `/retract-inbox` — alongside `/capture` and the existing read-side
  surfaces. All four share one internal handler that resolves the
  `target` from the command name and the per-target identifier field
  from the slash-command argument before calling
  `ctx.client.retract.retract`.
- The renderer (the existing `renderRetractResultPlain` reused, or a
  thin Telegram-local helper that delegates to it) emits one Telegram
  reply for every `RetractResult` arm, exhaustively covering each
  `RetractRecord` arm and each `ok: false` reason. The tasks-arm reply
  uses the seam's "moved to dropped" wording, not "deleted".
- The empty-argument, `not_found`, `no_contributors`, and
  `contributor_failed` branches each emit a distinct, fixed body so
  the operator can disambiguate them, matching the wording style
  already used by `/capture` and `/recall`.
- Tests cover: (a) the command-registration path for all four
  commands, (b) the rendering of each `RetractRecord` success arm
  (memory / knowledge / tasks / inbox) against a seam fixture,
  (c) the `not_found` / `no_contributors` / `contributor_failed`
  branches, (d) the empty-argument guard, and (e) the chat-allowlist
  gate applied uniformly to all four commands.
- The Telegram module's `AGENTS.md` lists the four `/retract-<store>`
  commands alongside the existing entries and notes that they are the
  cross-store retract surface (one explicit-target command per store,
  no classifier path because the seam has none). The module's
  `dependencies` array gains `retract` if the render helper is reused.
- A captured Telegram transcript (or equivalent test fixture) under
  the run directory shows: (1) `/retract-memory <id>` succeeding for
  a known memory id with the typed identifier rendered,
  (2) `/retract-tasks <id>` succeeding with the "moved to dropped"
  wording, (3) the `not_found` reply rendered for an unknown
  identifier under one target.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

The cross-store retract seam landed at commit `546cacab` (see
`task-add-a-unified-cross-store-retract-seam-mirroring-c.md`, done
2026-04-28). That seam task explicitly scoped surface adoption —
Telegram, web, macOS, mobile — out of the seam itself and called for
them to land later as honest single-task follow-ups, mirroring the
capture/recall/answer pattern. The retract module's own `AGENTS.md`
records the same expectation. This task is the first of those follow-
ups. Telegram is the natural first surface because the operator's
chat history is where stale captures are most often noticed (a
mis-classified memory note, a duplicate task, a stray inbox line),
and because every other channel adoption (`/capture` on Telegram is
done; web `CapturePanel`, mobile `CaptureScreen`, macOS `CaptureView`,
Slack-channel `/capture` are done) has already used Telegram as the
first chat-surface anchor. Naming and shape mirror the prior Telegram
`/capture` task (`task-add-telegram-capture-command-consuming-the-
cross-s.md`, done 2026-04-28), with the structural difference that
retract has no classifier and therefore no unguided primary command.

## Initiative

Cross-store correction parity — the symmetric correction-side
counterpart to the cross-store capture/recall/answer initiative.
Bringing the single-seam retract experience to chat is the first
demonstration of the retract seam's value beyond the CLI and the
agent tool, and the foundation for the macOS / mobile / web / Slack-
channel fan-out follow-ups.

## Acceptance Evidence

- Diff covering the new four Telegram `/retract-<store>` command
  registrations, the shared handler, the render path, the tests, and
  the Telegram module `AGENTS.md` update.
- Unit tests for the rendered output against a `RetractResult`
  fixture spanning every `RetractRecord` arm and every `ok: false`
  reason, the empty-argument guard, and the chat-allowlist gate.
- A transcript fixture (or captured chat reply) under the run
  directory showing: (1) `/retract-memory <id>` succeeding with the
  typed identifier rendered, (2) `/retract-tasks <id>` succeeding
  with the seam's "moved to dropped" wording, (3) the `not_found`
  reply rendered for an unknown identifier under one target.
