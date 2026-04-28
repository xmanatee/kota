---
id: task-add-telegram-capture-command-consuming-the-cross-s
title: Add Telegram /capture command consuming the cross-store capture seam
status: done
priority: p2
area: modules
summary: Add a Telegram /capture <text> command that consumes the cross-store capture seam (KotaClient.capture) and routes one natural-language note into memory / knowledge / tasks / inbox via the seam's classifier, with explicit /capture-to-<store> twins for the four targets, mirroring the established Telegram /recall and /answer adoption pattern. First single honest surface follow-up of the capture seam; macOS, mobile, and web adoption land later as separate tasks.
created_at: 2026-04-28T03:44:30.173Z
updated_at: 2026-04-28T03:59:14.491Z
---

## Problem

The cross-store capture seam landed at commit `805a6edf` with a
`CaptureProvider` primitive, a `CaptureContributor` registry binding
memory / knowledge / tasks / inbox writers, a `POST /capture` daemon
route plus its `POST /api/capture` user-facing twin, the
`KotaClient.capture` namespace, and a `kota capture <text>` CLI
subcommand with `--target` / `--hint` / `--json`. The seam intentionally
shipped without channel/client adoption so it would not seed another
five-surface fan-out chain (see the `## Initiative` section of
`task-add-a-unified-cross-store-capture-seam-routing-one.md`).

The Telegram bot already exposes `/recall` (commit `6510f998`) and
`/answer` (the cited-answer composition surface) as the unified
read-side cross-store entries. What it does not yet expose is the
symmetric *write-side* entry — a single `/capture <text>` that takes
"remember this" / "save this thought" / "file this idea" from the
operator's phone and routes it into the right store without forcing the
operator to pre-decide between `/memory`, `/knowledge`, `/tasks`, or a
manual inbox edit.

This is the highest-leverage capture surface in the entire chain.
Personal-assistant capture happens overwhelmingly from a phone — at
the desk a CLI is often closer. Without a chat surface, the seam's
classifier and ambiguous-degradation envelope never reach the operator
where the friction actually exists.

## Desired Outcome

- The Telegram channel exposes a primary `/capture <text>` command,
  registered alongside the existing `/recall`, `/answer`,
  `/knowledge`, `/memory`, `/history`, and `/tasks` commands and gated
  by the same chat allowlist.
- Four explicit override twins — `/capture-to-memory`,
  `/capture-to-knowledge`, `/capture-to-tasks`, `/capture-to-inbox`,
  each accepting the same `<text>` argument — provide the operator's
  manual override path without overloading slash arguments. They map
  one-to-one to the seam's `target` field (`CaptureTarget` literal
  union), so the wiring is exhaustive at command-registration time.
- Each command is a thin wrapper over
  `ctx.client.capture.capture({ text, target?, hint? })` — no second
  classifier prompt, no parallel routing logic, no per-store fan-out
  inside the Telegram module. The seam already owns classification,
  contributor dispatch, ambiguous-degradation, and contributor-failure
  isolation.
- The reply renders the typed `CaptureResult` envelope exhaustively:
  - `ok: true` → a one-line confirmation naming the resolved store
    plus the typed identifier the contributor returned (memory id,
    knowledge slug, task id, inbox file slug).
  - `ok: false; reason: "ambiguous"` → a fixed body listing the
    suggested targets and explaining how to re-issue with one of the
    four `/capture-to-*` commands (or a `--target` hint via the CLI),
    so the operator can disambiguate without leaving chat.
  - `ok: false; reason: "no_contributors"` → a fixed body explaining
    that the seam is unconfigured (zero contributors registered, or
    the requested target is not registered). Distinct wording from
    `ambiguous`.
  - `ok: false; reason: "contributor_failed"` → a fixed body that
    surfaces the target plus the contributor's verbatim error message.
    No silent retry into another store; no cross-store fallback in the
    Telegram layer.
- Empty / whitespace-only `<text>` is treated the same way the seam
  itself treats it: surface the `ambiguous` envelope with the full
  suggestions list. The Telegram handler refuses to call `/capture`
  with an empty body.
- `/recall` and `/answer` stay as-is. `/capture` is additive — it
  augments chat with a symmetric write-side entry but does not replace
  the unified read-side surfaces; both directions have distinct
  operator value.

## Constraints

- One mechanism. The five commands consume the existing `capture`
  namespace on `KotaClient`; they do not introduce a second classifier
  path, a second prompt, a second contributor registry, or a per-store
  fan-out router. The four `/capture-to-*` twins are sugar over a
  single shared handler that sets `target` to a literal value before
  dispatching; they share rendering and failure handling with the
  classifier path.
- Strict typed protocols. The renderer consumes the seam's
  discriminated `CaptureResult` union exhaustively (`ok: true` and the
  three `ok: false` reasons) with no `default` branch. Each
  `CaptureRecord` arm is rendered by direct switch on `target` with
  exhaustive coverage. No optional fields, no silent fallbacks, no
  per-store nullability shims in the Telegram layer.
- The Telegram module must not import from `#modules/capture` directly
  for runtime behavior beyond the typed `KotaClient.capture` namespace
  it consumes. If a typed render helper from the capture module is
  reused (e.g. a `renderCaptureResultPlain` exported from
  `src/modules/capture/render.ts`), declare `capture` in the Telegram
  `KotaModule.dependencies` array alongside the existing dependencies.
  Per the cross-module import rule in
  `src/modules/AGENTS.md`, this declaration is enforced by
  `src/core/modules/module-deps.test.ts` at load time.
- Chat-allowlist gating only. Do not gate `/capture` (or any
  `/capture-to-*` twin) behind quiet hours — capture is a write
  initiated by the operator, not a notification. Matches `/recall`
  and `/answer`.
- One classifier call per `/capture` invocation by default — and zero
  classifier calls per `/capture-to-*` twin (the explicit-target path
  bypasses classification by contract). The Telegram handler must
  not add a per-message budget enforcement layer; cost stays in the
  seam's existing cost-tracker integration.
- Cost signals do not flow back to the operator chat reply. Match the
  existing repo standing rule: no per-query cost dashboard, no token
  count surfaced into the chat message, no autonomy-facing cost feed.
- No legacy or compatibility shim. `/capture` plus its four
  explicit-target twins are the only Telegram surfaces for cross-
  store capture. The reply formats above are the only formats; no
  opt-in flag, no v2 path, no inline `/capture knowledge: <text>`
  modifier syntax, no legacy `/remember` alias.

## Done When

- The Telegram bot command set registers exactly five new commands —
  `/capture`, `/capture-to-memory`, `/capture-to-knowledge`,
  `/capture-to-tasks`, `/capture-to-inbox` — alongside `/recall`,
  `/answer`, and the per-store search commands. All five share one
  internal handler that resolves the `target` from the command name
  (or leaves it `undefined` for the unguided primary command) before
  calling `ctx.client.capture.capture`.
- The renderer (either co-located with the Telegram handler or a
  helper exported from `src/modules/capture/render.ts` and reused)
  emits one Telegram reply for every `CaptureResult` arm, exhaustively
  covering each `CaptureRecord` arm and each `ok: false` reason.
- The empty-text, `ambiguous`, `no_contributors`, and
  `contributor_failed` branches each emit a distinct, fixed body so
  the operator can disambiguate them, matching the wording style
  already used by `/recall` and `/answer`.
- Tests cover: (a) the command-registration path for all five
  commands, (b) the rendering of each `CaptureRecord` success arm
  (memory / knowledge / tasks / inbox) against a seam fixture,
  (c) the `ambiguous` / `no_contributors` / `contributor_failed`
  branches, (d) the empty-text guard, and (e) the chat-allowlist gate
  applied uniformly to all five commands.
- The Telegram module's `AGENTS.md` lists the five `/capture*`
  commands alongside the existing entries and notes that they are the
  cross-store capture surface (one classifier path plus four explicit
  override twins), not a second per-store write fan-out. The module's
  `dependencies` array gains `capture` if the render helper is reused.
- A captured Telegram transcript (or equivalent test fixture) under
  the run directory shows `/capture <text>` succeeding through the
  classifier into one store, plus `/capture-to-knowledge <text>`
  succeeding through the explicit-target path, plus the `ambiguous`
  reply rendered for an unguided text where classification is
  unavailable.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

The cross-store capture seam landed at commit `805a6edf` (see
`task-add-a-unified-cross-store-capture-seam-routing-one.md`, done
2026-04-28). That seam task explicitly scoped surface adoption —
Telegram, web, macOS, mobile — out of the seam itself and called for
them to land later as honest single-task follow-ups, not as a parallel
five-surface fan-out chain. Chat is the highest-leverage first surface
for capture, since most "remember this" / "save this thought" inputs
actually originate from the operator's phone. This task is that first
single follow-up; macOS, mobile, web, and end-to-end integration land
as separate substantive tasks. The naming and shape mirror the prior
Telegram /recall task
(`task-add-telegram-recall-command-exposing-the-unified-c.md`, done
2026-04-27) and the prior Telegram /answer task
(`task-add-telegram-answer-command-consuming-the-cited-an.md`, done
2026-04-27) so the three chat surfaces are operationally consistent.

## Initiative

Cross-store capture parity — the symmetric write-side counterpart to
the cross-store recall+answer initiative just closed. Bringing the
single-seam capture experience to the chat surface — where most
personal-assistant capture actually originates — is the first
demonstration of the capture seam's value beyond the CLI, and the
foundation for the macOS / mobile / web fan-out follow-ups.

## Acceptance Evidence

- Diff covering the new five Telegram `/capture*` command
  registrations, the shared handler, the render path, the tests, and
  the Telegram module `AGENTS.md` update.
- Unit tests for the rendered output against a `CaptureResult` fixture
  spanning every `CaptureRecord` arm and every `ok: false` reason, the
  empty-text guard, and the chat-allowlist gate.
- A transcript fixture (or captured chat reply) under the run
  directory showing: (1) `/capture <text>` succeeding through the
  classifier into one store with the typed identifier rendered,
  (2) `/capture-to-knowledge <text>` succeeding through the
  explicit-target path, (3) the `ambiguous` reply rendered for an
  unguided text when classification is unavailable.
