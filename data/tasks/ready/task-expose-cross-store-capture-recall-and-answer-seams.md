---
id: task-expose-cross-store-capture-recall-and-answer-seams
title: Expose cross-store capture, recall, and answer seams as first-class agent tools
status: ready
priority: p1
area: architecture
summary: Add agent-callable tool definitions wrapping the existing CaptureProvider, RecallProvider, and AnswerProvider so per-user agent sessions can automatically capture noteworthy info, recall context, and produce cited answers mid-conversation, instead of requiring explicit /capture /recall /answer slash commands; closes the gap between a command-driven and a conversational personal assistant by adding one tool surface that every channel that hosts an agent session inherits for free.
created_at: 2026-04-28T09:11:21.468Z
updated_at: 2026-04-28T09:11:21.468Z
---

## Problem

The cross-store seams the last ~30 commits shipped — `CaptureProvider`,
`RecallProvider`, `AnswerProvider` — are reachable today only through:

- `kota capture`, `kota recall`, `kota answer` CLI subcommands.
- Daemon HTTP routes (`POST /capture`, `POST /recall`, `POST /answer`,
  plus their `/api/*` user-facing twins).
- Channel slash commands (`/capture`, `/recall`, `/answer`, plus the
  per-target `/capture-to-*` twins) on Telegram and Slack.
- Web/macOS/mobile clients that consume the daemon HTTP routes through
  `KotaClient.{capture,recall,answer}`.

None of these are agent-callable. A per-user agent session running inside
a channel (Telegram chat, Slack DM, web chat, macOS chat, mobile chat,
or interactive `kota` REPL) cannot reach into the cross-store seams
unless the human user *explicitly* types a slash command. The agent has
no first-class way to:

- Notice a chat-resident fact worth remembering and route it through the
  classifier into the right store via `CaptureProvider`.
- Pull cross-store context relevant to the current message via
  `RecallProvider` before forming a reply.
- Produce a cited answer through `AnswerProvider` (with the same
  answer-history trail every other surface populates) instead of
  free-styling from raw tool output.

That makes KOTA a command-driven assistant rather than a conversational
one: the seams exist, but the natural path through every channel — the
agent session — bypasses them. It also leaves answer-history empty
during normal conversational turns, even though those turns answer real
questions, so the just-shipped answer-history surface (CLI, daemon,
Telegram, Slack, web, macOS, mobile) misses every reply that came from
a free-form agent turn instead of an explicit `/answer`.

## Desired Outcome

Per-user agent sessions can call three new tools mid-conversation that
go through the existing cross-store seams without any per-channel
plumbing:

- `capture` — input is the natural-language note plus optional
  `target` and `hint`; output is the same discriminated `CaptureResult`
  every other surface receives. Routes through `CaptureProvider` so the
  classifier, contributor registry, and `CaptureRecord` arms stay the
  one source of truth.
- `recall` — input is the query plus optional per-store filters; output
  is the same `RecallResult` shape (ranked hits across knowledge,
  memory, history, tasks) every other surface receives. Routes through
  `RecallProvider` so contributors, ranking, and source attribution
  stay uniform.
- `answer` — input is the question plus optional context override;
  output is the same discriminated `AnswerResult` (synthesized arm with
  citations, no-context arm, etc.) every other surface receives. Routes
  through `AnswerProvider` so the answer-history append happens once,
  here too, identical to `/answer` and `kota answer`.

The tools are contributed by the owning capture / recall / answer
modules through the standard `KotaModule.tools` contribution path. They
become available in any session whose tool policy admits them; channels
do not need bespoke wiring.

## Constraints

- One source of truth per seam. The new tools wrap the existing
  providers and reuse their discriminated result types verbatim — no
  parallel argument schema, no parallel result shape, no second
  classifier prompt, no second answer-history writer.
- The owning modules contribute the tools (capture module ships the
  `capture` tool, recall module ships the `recall` tool, answer module
  ships the `answer` tool). Do not add a new "agent-tools" module that
  reaches sideways into three other modules.
- Each tool declares a typed risk classification consistent with the
  existing tool-risk model (capture and recall are read/write store
  operations; classify against the same risk bands the equivalent
  daemon routes already trust).
- Renderings reuse the module-owned plain-text renderers
  (`renderCaptureResultPlain`, `renderRecallResultsPlain`,
  `renderAnswerReplyPlain`) so a tool result rendered into a session
  transcript matches the slash-command surface byte-for-byte.
- No test-only flags or branches. Tool wiring must be a clean
  module-contribution path that any channel session can opt into.
- The change must not break any existing surface (CLI, daemon HTTP,
  Telegram, Slack, web, macOS, mobile). The provider call path is
  unchanged; only a new tool entrypoint is added.
- Every cited-answer turn through the new `answer` tool must append to
  the same `AnswerHistoryStore` as `/answer` and `kota answer`, so
  conversational answers show up in `/answer-log` and the macOS, web,
  mobile, Slack, Telegram, and CLI history surfaces.

## Done When

- The capture, recall, and answer modules each contribute one new
  agent-callable tool through the standard `KotaModule.tools` path,
  wired against their existing in-process provider.
- Co-located tests assert each tool's argument schema, success arm,
  and at least one failure arm (ambiguous capture, empty recall, no
  recall context for answer) by calling the tool runner directly
  against a real provider with seeded contributors.
- One end-to-end test boots a per-user agent session against the new
  tools and asserts the agent can: (a) call `capture` with a
  short note and see a `CaptureRecord` in the matching store; (b)
  call `recall` and see ranked hits across knowledge / memory /
  history / tasks; (c) call `answer` on a seeded question and see a
  cited answer plus a fresh `AnswerHistoryRecord` appended to the
  same store `/answer-log` reads from.
- `pnpm test` and `pnpm typecheck` pass on the project root.
- The capture, recall, and answer module `AGENTS.md` files document
  the new agent-tool contribution alongside the existing CLI / daemon
  route / KotaClient namespace bullets.

## Source / Intent

Run `2026-04-28T09-07-15-219Z-explorer-23u8cd` (this run) identified
the gap during empty-queue exploration. Surface fan-out across CLI,
daemon HTTP, Telegram, Slack, web, macOS, and mobile is now mostly
closed for capture / recall / answer / answer-history (`771` done
tasks, the last ~30 commits all in this fan-out). The next strategic
move is *not* another N-surface fan-out — it is closing the path that
every channel's per-user agent session takes today, which bypasses the
seams entirely. Without this, KOTA stays command-driven; the
conversational personal-assistant outcome the recent fan-out aimed at
remains aspirational.

## Initiative

Cross-store personal-assistant seam — bringing the unified capture /
recall / answer surface into the per-user agent session so a normal
conversational turn can reach the same stores the explicit slash
commands do. This is the conversational counterpart to the
already-shipped command-driven fan-out.

## Acceptance Evidence

- The end-to-end agent-session test transcript described in **Done
  When**, captured under the run directory, showing the agent
  calling `capture`, `recall`, and `answer` and producing the
  expected discriminated results.
- `kota answer log` (or `/answer-log` in any channel) showing a
  fresh `AnswerHistoryRecord` produced by the agent's `answer` tool
  call, identical in shape to records produced by explicit `/answer`.
- Co-located unit tests for each of the three new tools, asserting
  schema and at least one success and one failure arm per tool.
