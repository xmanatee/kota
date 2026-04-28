---
id: task-anchor-retract-through-the-conversational-agent-lo
title: Anchor retract through the conversational agent loop with end-to-end integration tests
status: ready
priority: p2
area: modules
summary: Extend src/conversational-agent-tools.integration.test.ts and src/conversational-prompt-priming.integration.test.ts to cover the retract module so the latest cross-store seam has the same agent-loop coverage as capture/recall/answer.
created_at: 2026-04-28T14:45:19.074Z
updated_at: 2026-04-28T14:45:19.074Z
---

## Problem

The cross-store retract seam (commit 546cacab) ships a `KotaModule.tools`
contribution with `risk: dangerous` and a per-turn dynamic system-prompt
contributor that the dynamic-state registry gates by tool admission. Both
have unit tests in `src/modules/retract/tool.test.ts` and
`src/modules/retract/system-prompt.test.ts`, but neither is exercised by an
integration test that boots a real agent loop.

For its three peer modules, two integration anchors close that gap:

- `src/conversational-agent-tools.integration.test.ts` boots the
  `openai-tools` harness against the production providers and asserts the
  end-to-end `capture → recall → answer` round trip plus a fresh
  `AnswerHistoryRecord` reachable through `DiskAnswerHistoryStore`.
- `src/conversational-prompt-priming.integration.test.ts` seeds a knowledge
  entry, asserts the per-turn dynamic state contains all three blocks when
  every tool is admitted, exercises the production
  `RecallProviderImpl` → `AnswerProviderImpl` chain, and asserts the
  negative cases where capture/answer guidance is suppressed.

Retract has no equivalent coverage. A regression in the retract module's
tool wiring through `KotaModule.tools`, in the retract system-prompt
contributor's `activeTools` gating, or in the prompt block emitted on
admission would be silent at the integration level — for a `dangerous`
tool that mutates user-visible stores, that is a meaningful coverage gap.

## Desired Outcome

The two existing conversational integration tests cover retract end-to-end
on the same shape they already cover capture/recall/answer:

- `conversational-agent-tools.integration.test.ts` proves an agent session
  with the retract tool admitted can retract a previously-captured entry
  mid-conversation through the production `RetractProvider` wiring, and
  that a follow-up `RecallProviderImpl` query no longer surfaces the
  retracted record (the read-side seam settles).
- `conversational-prompt-priming.integration.test.ts` covers both
  admission arms for the retract block: present in the per-turn dynamic
  state when the retract tool is admitted, absent when it is excluded —
  matching the existing positive/negative coverage for capture and
  answer.

The first test exercises the end-to-end behavioral round trip; the second
test pins the gating contract for a `dangerous` tool's prompt priming.

## Constraints

- Do not add a new top-level integration test file. Extend the two
  existing files so the retract arm sits next to its peers and the same
  fixture/harness setup is reused.
- The behavioral test must use the production `RetractProviderImpl` plus
  the four real first-party contributors against in-process `MemoryStore`
  / `KnowledgeStore` instances and a temp project root, mirroring
  `src/retract-pipeline.integration.test.ts`. Do not mock the retract
  provider.
- Do not loosen tool admission gating to make assertions easier. The
  positive and negative arms must drive the production
  `dynamic-state` registry through `loop-send.ts` the way the existing
  capture/answer arms already do.
- Retract is `risk: dangerous`. The agent-loop test must run under
  whatever autonomy mode the existing capture/recall/answer agent-loop
  test uses — do not silently elevate autonomy posture to admit the tool.
  If the existing posture excludes `dangerous` tools, configure tool
  admission explicitly through the same surface the production daemon
  uses; do not add a test-only override.
- Keep both files under the repo's 300-line limit; if the round-trip
  fixture pushes either over the limit, extract a shared helper in the
  same `src/` directory rather than splitting the test file by feature.
- Stay within the explorer write scope. Implementation belongs to a
  builder run; this task only defines the desired behavior and gaps.

## Done When

- `src/conversational-agent-tools.integration.test.ts` includes a retract
  arm that captures an entry, retracts it through the agent loop, and
  asserts a follow-up recall returns no hit for that entry's content.
- `src/conversational-prompt-priming.integration.test.ts` includes both
  the positive (admitted → block present) and negative (excluded → block
  absent) arms for the retract module's system-prompt contributor, with
  the same shape as the existing capture and answer arms.
- Both tests pass under `pnpm test` and exercise production providers,
  not test doubles.
- No new top-level integration test files are introduced; both existing
  files remain ≤ 300 lines or share a co-located helper.
- `src/modules/retract/AGENTS.md` notes the integration-anchor location
  alongside the existing unit-test pointers, matching the pattern other
  cross-store seam modules follow.

## Source / Intent

Runtime evidence: the retract seam landed in commit 546cacab on
2026-04-28 with a tool plus a system-prompt contributor. Slash-command
fanout to web/Telegram/macOS/mobile/Slack completed in commits e24bf8e3
through 0521e0be the same day, leaving the agent-loop integration
coverage as the only seam-level gap. The unit tests at
`src/modules/retract/tool.test.ts` and
`src/modules/retract/system-prompt.test.ts` exist; the integration
counterparts do not.

`grep -L retract src/conversational-*.integration.test.ts` confirms
neither integration anchor mentions retract today, while
`src/conversational-agent-tools.integration.test.ts` already exercises
the production `openai-tools` harness end-to-end and
`src/conversational-prompt-priming.integration.test.ts` already
asserts the gated-block contract for the three peer modules.

## Initiative

Conversational personal-assistant correction loop. Retract is the
append-only escape hatch for the cross-store capture/recall/answer
triad: an agent session that captures something wrong needs to be able
to undo it mid-conversation rather than appending a contradicting note,
so memory and knowledge can settle into a consistent shape rather than
only growing. Anchoring retract at the agent-loop integration level is
the last seam-level coverage step that makes this loop a load-bearing
behavioral contract instead of an aspirational set of unit-tested
pieces.

## Acceptance Evidence

- `pnpm test src/conversational-agent-tools.integration.test.ts` passes
  with the new retract arm; the run output shows a retract round-trip
  (capture → retract → recall returns empty for that content) executed
  against the production `RetractProviderImpl` and `RecallProviderImpl`.
- `pnpm test src/conversational-prompt-priming.integration.test.ts`
  passes with both retract arms; the dynamic-state assertion logs show
  the retract block present when the tool is admitted and absent when
  it is excluded.
- `git diff` shows changes only in the two integration test files (and
  optionally one shared helper in `src/`) plus the AGENTS.md pointer
  update under `src/modules/retract/`. No new top-level test files.
