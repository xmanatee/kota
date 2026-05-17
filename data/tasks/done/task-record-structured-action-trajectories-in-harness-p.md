---
id: task-record-structured-action-trajectories-in-harness-p
title: Record structured action trajectories in harness parity runs
status: done
priority: p2
area: modules
summary: Extend harness-parity artifacts with a typed action/observation trajectory captured from AgentHarness onMessage frames so parity evidence shows what each coding harness actually did, not only streamed text and final diff.
created_at: 2026-05-17T12:29:47.000Z
updated_at: 2026-05-17T12:42:51.000Z
---

## Problem

`src/modules/harness-parity/` proves outcome quality with a prompt,
streamed text tail, final diff, verification result, and capability snapshot.
That is enough to see whether a scenario passed, but it is weak evidence for
how a harness got there. When one harness passes and another fails, operators
currently compare prose traces and diffs instead of a structured action /
observation sequence.

KOTA already has a strict `AgentHarnessRunOptions.onMessage` protocol with
typed `tool_call`, `tool_result`, `status`, `text`, `thinking`, `result`, and
`raw` frames. Harness parity does not subscribe to it. The result is a gap
between the protocol KOTA owns and the evidence artifact operators need.

mini-SWE-agent's useful peer signal is not its bash-only tool model; KOTA
should keep typed tools and module-owned capability boundaries. The useful
signal is evidence ergonomics: a simple linear trajectory makes debugging,
fixture extraction, and harness comparison much easier than interpreting a
streamed transcript after the fact.

## Desired Outcome

Every harness-parity run records an ordered, structured action trajectory
beside the existing artifacts.

For harnesses whose capability snapshot declares `emitsAgentMessageStream:
true`, `runScenarioOnHarness` passes an `onMessage` collector into
`runAgentHarness` and writes the ordered frames to a stable artifact such as
`trajectory.jsonl` or `trajectory.json`. A human-readable
`trajectory-summary.md` reduces the same frames to the sequence of tool calls,
tool results, status frames, and final result.

For harnesses that do not emit KOTA-native message frames, the run writes an
explicit trajectory artifact that says the trajectory is unsupported by that
harness. This is evidence, not an error: native CLIs and text-only harnesses
should remain comparable without pretending a structured trajectory exists.

The top-level `parity.json` includes enough trajectory metadata for operators
to see which harnesses emitted structured frames, how many action/result pairs
were captured, and where the detailed artifact lives.

## Constraints

- Reuse `AgentHarnessRunOptions.onMessage` and the existing
  `KotaAgentMessage` discriminated union. Do not scrape `trace.txt` or add a
  provider-specific parallel trajectory schema.
- Preserve provider-specific frames only through the existing `raw` variant
  with the adapter name. Do not loosen the typed message protocol to accept
  arbitrary records.
- Keep large tool results bounded in artifacts with an explicit truncation
  marker, while preserving `toolUseId`, `toolName`, `isError`, and ordering.
- Do not require native CLI harnesses to emit message frames as part of this
  task. Record their unsupported status honestly.
- Do not add a second benchmarking or scoring path. This is an artifact
  quality lift inside harness parity; eval-harness scoring remains separate.
- Keep cost fields operator-facing only and out of any agent-facing prompt or
  trajectory replay input.

## Done When

- `runScenarioOnHarness` captures `onMessage` frames for message-streaming
  harnesses and writes a stable trajectory artifact plus a concise summary
  artifact under each harness run directory.
- Non-streaming harnesses still complete harness-parity runs and write an
  explicit unsupported trajectory artifact instead of failing or silently
  omitting the file.
- `parity.json` carries trajectory availability and artifact path metadata for
  each harness outcome.
- Focused tests cover a fake streaming harness that emits at least one
  `tool_call` / `tool_result` pair, preserves frame order, and records the
  final result; a fake non-streaming harness that records unsupported status;
  and truncation of oversized result content.
- `src/modules/harness-parity/AGENTS.md` stays aligned with the artifact
  shape at the conventions level.

## Source / Intent

Explorer refresh of
https://github.com/SWE-agent/mini-swe-agent on 2026-05-17. The repo and docs
describe a compact coding-agent runtime built around bash-only actions, a
linear history, independent subprocess execution, and trajectory browsing.
KOTA should not copy the bash-only agent interface, but it should borrow the
artifact lesson: parity evidence is more useful when the action sequence is
structured and linear.

The current queue has no actionable ready/backlog work. The strategic blocked
alternatives are all real operator-capture waits, so opening this focused
modules task is the right nonduplicative next step.

## Initiative

Harness-parity evidence quality: KOTA should make cross-harness coding-agent
comparison inspectable through typed artifacts, not only final diffs and
streamed prose.

## Acceptance Evidence

- `pnpm test -- src/modules/harness-parity/runner.test.ts`
- A harness-parity test artifact or fixture showing `trajectory.jsonl` /
  `trajectory-summary.md` for a streaming fake harness and an explicit
  unsupported trajectory artifact for a non-streaming fake harness.
- `parity.json` in the same test output references the trajectory artifact and
  exposes the captured frame count or unsupported status.
