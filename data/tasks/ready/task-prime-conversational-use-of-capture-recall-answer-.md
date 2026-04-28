---
id: task-prime-conversational-use-of-capture-recall-answer-
title: Prime conversational use of capture / recall / answer agent tools via module-contributed system-prompt state
status: ready
priority: p1
area: architecture
summary: Teach per-user agent sessions when to call the just-shipped capture/recall/answer tools mid-conversation by contributing module-owned system-prompt state from each owning module, so the cross-store seams stop being mechanically-available-but-conversationally-invisible.
created_at: 2026-04-28T09:44:33.850Z
updated_at: 2026-04-28T09:44:33.850Z
---

## Problem

The just-landed `capture`, `recall`, and `answer` agent tools
(`7e67473e Expose cross-store capture/recall/answer seams as
agent-callable tools`) close the mechanical gap: a per-user agent
session can now call into `CaptureProvider`, `RecallProvider`, and
`AnswerProvider` mid-turn without an explicit slash command. But the
session-wide system prompt (`src/core/agents/system-prompt.ts`) is
provider-agnostic. It teaches the agent to use generic tools (web,
code, shell, delegate, todo, ask_user) and says nothing about KOTA's
distinctive cross-store seams. Tool-level descriptions exist, but a tool
description is a "what is this" surface; it does not establish the
conversational pattern that makes the seams useful — recall context
before answering, capture noteworthy chat-resident facts, prefer cited
answers over free-form replies for fact-shaped questions.

The result is a predictable failure mode: the tools are wired but
unused. A normal conversational turn keeps free-styling from raw model
knowledge instead of grounding in cross-store context, and
answer-history (the surface the last six fan-out tasks just shipped to
CLI / daemon / Telegram / Slack / web / macOS / mobile) keeps showing
only explicit `/answer` traffic. The sprint's stated outcome —
"conversational personal-assistant" — depends on the agent actually
choosing these tools. Today nothing tells it to.

There is a clean mechanism for this. Modules already register per-turn
dynamic system-prompt state contributors through the module context
(`registerSystemPromptStateContributor` on the module API in
`src/core/modules/module-types.ts:231`, surfaced through the
`ModuleContext` passed to every module). The capture, recall, and
answer modules should each contribute one short policy block describing
the conversational pattern that calls into their tool, scoped to
sessions where the matching tool is admitted by tool policy.

## Desired Outcome

- Per-user agent sessions running inside any channel (Telegram, Slack,
  web, macOS, mobile, interactive `kota` REPL) receive a short,
  module-owned system-prompt addition for each of the cross-store
  tools their policy admits, naming when to call `capture`, `recall`,
  and `answer` mid-conversation.
- The agent grounds fact-shaped questions in `recall` results before
  answering, prefers `answer` (cited, history-tracked) over free-form
  text for questions that ask for a synthesized reply, and routes
  noteworthy chat-resident facts through `capture` instead of relying
  on the user typing `/capture`.
- The contribution path is module-owned: the capture module ships its
  block, the recall module ships its block, the answer module ships
  its block — none of them edit `src/core/agents/system-prompt.ts` and
  no new "agent-prompt" module is introduced that reaches sideways
  into the three owning modules.
- A session whose tool policy excludes one of these tools does not
  receive the corresponding block (no instructions for tools the agent
  cannot call).

## Constraints

- One source of truth per seam. The system-prompt block lives in the
  same module that owns the tool, beside `tool.ts` and the module's
  `index.ts` registration.
- Use the existing `registerSystemPromptStateContributor` API. Do not
  add a parallel registry or a new core entrypoint for "agent-priming
  state".
- Each block stays short (target ≲10 lines) and conversational-pattern
  focused. No restating the JSON-Schema description; the tool
  description already covers shape. Focus on *when* to call the tool
  and how to thread the result back into the reply.
- Block contribution is gated by the session's effective tool policy:
  if the agent cannot call `recall`, the recall block is not injected.
  This avoids prompting the agent to use a tool it does not have.
- No edits to `src/core/agents/system-prompt.ts` for this task. The
  generic system prompt stays generic; the cross-store guidance is
  module-owned per-turn state, not a hardcoded core surface.
- No test-only flags. The contribution pathway must be a clean
  module-side use of the existing API.
- The change must not break any existing surface (CLI, daemon HTTP,
  Telegram, Slack, web, macOS, mobile). The provider call paths and
  tool argument schemas are unchanged.

## Done When

- Capture, recall, and answer modules each register a per-turn
  system-prompt state contributor via `ModuleContext` that emits a
  short conversational-pattern block when the matching tool is in the
  effective tool policy and emits nothing otherwise.
- Co-located unit tests in each module assert: (a) block is injected
  when the tool is admitted; (b) block is NOT injected when the tool
  is excluded; (c) the block names the tool and the conversational
  trigger.
- One end-to-end agent-session test seeds a per-user session with all
  three tools admitted, sends a fact-shaped user message that has a
  matching seeded knowledge entry, and asserts the agent's first tool
  call is `recall` (not free-form generation), followed by `answer`,
  with a fresh `AnswerHistoryRecord` appended — i.e. behavior changed,
  not just prompt text.
- A negative end-to-end test seeds a session whose tool policy admits
  only `recall` (capture and answer excluded) and asserts the
  system-prompt does not contain capture/answer guidance.
- `pnpm test` and `pnpm typecheck` pass on the project root.
- The capture, recall, and answer module `AGENTS.md` files document
  the new system-prompt contribution alongside the existing tool /
  CLI / daemon route bullets, naming the contributor entry point.

## Source / Intent

Run `2026-04-28T09-43-06-381Z-explorer-95uxus` (this run) identified
the gap during empty-queue exploration immediately after
`7e67473e Expose cross-store capture/recall/answer seams as
agent-callable tools` landed. The last ~30 commits closed surface
fan-out for the cross-store seams and the agent-callable tools task
closed the mechanical gap. The next strategic move is converting
those tools from *available* to *actually used* in conversational
turns. Without this, the just-shipped `tool.ts` files in capture,
recall, and answer become dead conversational code: tool descriptions
exist, the runtime can call them, and the session-wide system prompt
gives the agent no reason to pick them over free-form replies.
The owner-facing claim of a "conversational personal assistant"
depends on the agent actually grounding turns in cross-store state,
which depends on this task.

## Initiative

Cross-store personal-assistant seam — converting the just-shipped
agent-callable surface from mechanically-available to behaviorally-
default in conversational turns. This is the conversational-quality
counterpart to the agent-tools wiring; together they realize the
"conversational rather than command-driven" assistant outcome the
recent fan-out aimed at.

## Acceptance Evidence

- The end-to-end agent-session transcript described in **Done When**,
  captured under the run directory, showing the agent calling
  `recall` first on a fact-shaped question and threading the result
  into a cited `answer`, with a fresh `AnswerHistoryRecord` visible
  through `kota answer log`.
- The negative-policy transcript showing the system-prompt diff for a
  recall-only session, asserting absent capture/answer guidance.
- Co-located unit tests for each module's contributor (admitted vs
  excluded behavior) referenced from the run artifacts.
