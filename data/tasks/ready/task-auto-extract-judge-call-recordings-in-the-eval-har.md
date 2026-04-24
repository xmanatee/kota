---
id: task-auto-extract-judge-call-recordings-in-the-eval-har
title: Auto-extract judge-call recordings in the eval-harness recorder
status: ready
priority: p1
area: modules
summary: Extend pnpm kota eval record-agent-step so judge-call recordings (builder critic-review, improver semantic-gate) are auto-produced from a source run's <runDir>/<judge>.json artifact, eliminating the last hand-transcription step in replay-fixture authoring.
created_at: 2026-04-24T21:13:38.957Z
updated_at: 2026-04-24T21:13:38.957Z
---

## Problem

The eval-harness recorder (commit `24041da3`) now auto-extracts every
repo-tree file mutation from a source run's commit diff and every
run-directory artifact from the step's `events.jsonl`, so seeding a
replay fixture for a plain workflow agent step is a single CLI call.
Judge-call recordings are the remaining hand-authored exception.

`src/modules/eval-harness/fixtures/builder-agent-call-replay/recordings/critic-review.json`
is authored by hand (see the fixture's `notes.md` §Recorder extraction:
"`recordings/critic-review.json` is still authored by hand: the critic
is a judge call, not a workflow step, so its response text is lifted
from the source run's `critic-review.json` rather than an agent-step
artifact"). The replay adapter already understands how to route
judge-prompt shapes to their own recording file per
`src/modules/eval-harness/replay-harness.ts`, and the recording format
is identical to an agent-step recording — only the source of the
response text differs.

The same tax will hit every future judge-backed fixture. Today that
means builder (critic-review), and as soon as the improver bootstrap
capability lands it also means improver's semantic gate
(`src/modules/autonomy/improver-semantic-gate.ts` writes to a
`<label>.json` artifact under the run directory the same way critic
does via `src/modules/autonomy/critic.ts:154 handleVerdict`). Leaving
this as a manual step silently re-introduces the same hand-
transcription cost the repo-tree auto-extraction task exists to
eliminate.

## Desired Outcome

`pnpm kota eval record-agent-step` learns a judge-recording mode that
reads the source run's judge artifact (`<sourceRunDir>/<label>.json`),
wraps its JSON content verbatim as the `response.text` of an
`AgentStepRecording`, and writes the recording to
`<fixtureDir>/recordings/<label>.json`. The author of a judge-using
replay fixture runs the CLI once per judge call and writes nothing by
hand.

Concretely:

- The recorder gains a `--judge <label>` (or equivalent flag named by
  the implementer) that, combined with `--run-id <id>` and
  `--fixture <id>`, resolves the source run directory, reads
  `<sourceRunDir>/<label>.json`, and emits an `AgentStepRecording`
  whose `stepId` equals the label and whose `response.text` is the
  JSON-stringified content of that artifact. `fileOperations` is
  always empty for judge recordings — a judge call has no tool
  access by contract (see `invokeAgentJudge` in
  `src/modules/autonomy/critic.ts:224` and the
  `AUTONOMY_DISALLOWED_TOOLS` list there).
- The mode is mutually exclusive with the existing `--step` mode. Both
  produce a recording under `<fixtureDir>/recordings/`; the label
  routes to the workflow-step vs judge path internally.
- The judge-recording path fails loudly with a typed error naming the
  run id and label when `<sourceRunDir>/<label>.json` is missing. A
  source run that did not invoke the named judge is not silently
  treated as an empty recording.
- The rest of the recording schema is unchanged (`version: 1`,
  `workflowName`, `stepId`, `sourceRunId`, `response`,
  `fileOperations`). `response.turns`, `totalCostUsd`, `inputTokens`,
  and `outputTokens` remain present as placeholders (`1`, `0`, `0`,
  `0`) for judge recordings since a judge artifact does not carry
  those fields on disk today, matching the current hand-authored
  shape in `builder-agent-call-replay/recordings/critic-review.json`.
- The builder fixture's `recordings/critic-review.json` is
  re-extracted with the new CLI in the same commit as the recorder
  change, as end-to-end verification. The hand-authored section of
  `builder-agent-call-replay/notes.md` (§Recorder extraction, final
  paragraph on `critic-review.json`) is rewritten to reflect the one-
  shot flow. `pnpm kota eval run --fixture builder-agent-call-replay`
  continues to pass deterministically with zero live-LLM calls.
- `src/modules/eval-harness/AGENTS.md` "Recorded Agent-Step Replay"
  section is extended in one short paragraph documenting the judge-
  recording mode, how the fixture directory holds both workflow-step
  and judge-call recordings side by side, and the failure mode when
  the labeled artifact is missing.

## Constraints

- Do not introduce a new recording schema or schema version. Judge
  recordings fit the existing `AgentStepRecording` shape; only the
  source of the response text and the always-empty `fileOperations`
  are judge-specific, and both already hold in
  `builder-agent-call-replay/recordings/critic-review.json` today.
- Do not add a parallel extraction surface. The judge mode lives
  inside the existing `extractAgentStepRecording` entry point (or a
  sibling exported from `recorder.ts` that shares the response-
  envelope normalization code). The CLI keeps one `record-agent-step`
  command.
- Do not change the replay adapter (`replay-harness.ts`). It already
  routes judge prompts to their own recording file by prompt-shape
  match; the new CLI produces exactly the files that routing already
  consumes.
- Do not hardcode judge labels in the recorder. The caller names the
  label; `critic-review` and any improver semantic-gate label are
  both valid. The recorder only needs the label to pick the artifact
  path and the output filename.
- Do not add a fallback that tries to infer judge calls from
  `events.jsonl` or `steps/*.json` when the labeled artifact is
  missing. That is the same kind of permissive coercion `AGENTS.md`
  forbids; a missing judge artifact is a hard error naming the run id
  and label.
- The KOTA-source bootstrap capability for improver is out of scope —
  this task unblocks the judge half of a future improver fixture, not
  the source-tree half.
- No cost signals in agent-facing context. The recorder continues to
  carry `usage` and `totalCostUsd` as evaluator-visible only; judge
  recordings keep the `0`/`0`/`0` placeholders used today.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
  `pnpm kota workflow validate` all pass.

## Done When

- `src/modules/eval-harness/recorder.ts` (and/or a peer file under the
  same module) exposes a judge-recording extraction path invoked via
  `pnpm kota eval record-agent-step --run-id <id> --fixture <id>
  --judge <label>` (or equivalent flag), producing
  `<fixtureDir>/recordings/<label>.json` with the source run's
  `<runDir>/<label>.json` JSON content as `response.text`, empty
  `fileOperations`, and the standard recording header.
- The CLI rejects the judge mode when the labeled artifact is missing
  from the source run, with the run id and label named in the error.
- `src/modules/eval-harness/recorder.test.ts` (or a co-located
  `recorder-judge.test.ts`) covers: (a) a source run with
  `critic-review.json` produces a valid judge recording end-to-end;
  (b) a source run missing the labeled artifact is rejected with a
  typed error naming the run id and label; (c) the produced recording
  loads cleanly through the existing recording loader and returns the
  expected verdict text when replayed.
- `src/modules/eval-harness/fixtures/builder-agent-call-replay/recordings/critic-review.json`
  is re-extracted with the new CLI in the same commit and the
  fixture's `notes.md` "Recorder extraction" section is rewritten to
  describe a one-shot flow (one invocation for the workflow step, one
  invocation for the critic-review judge) with no hand-authored
  recordings.
- `pnpm kota eval run --fixture builder-agent-call-replay` passes
  deterministically, captured as a per-run artifact under
  `.kota/runs/<run-id>/` showing zero live-LLM calls.
- `src/modules/eval-harness/AGENTS.md` "Recorded Agent-Step Replay"
  section gains one short paragraph on the judge-recording mode.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
  `pnpm kota workflow validate` all pass.

## Source / Intent

Direct follow-on to the just-landed recorder commit-diff extraction
(commit `24041da3`, task
`task-auto-extract-bash-and-edit-mutations-in-the-eval-h`). That task
eliminated hand-transcription for every `Bash`/`Edit`/`git mv`/task
CLI mutation by making the source run's commit diff the single
authoritative source. The same intent — "fixture authoring pays zero
hand-transcription tax once the source run is chosen" — extends
naturally to judge-call recordings, which are the last remaining
hand-authored file in the load-bearing builder replay fixture and will
be the same tax in every future judge-backed fixture (improver's
semantic gate, any new judge that a future workflow adds). Closing
this gap before a third or fourth judge-backed fixture encodes the
manual step preserves the cost curve the builder/decomposer replay
work was designed around.

## Initiative

Eval-harness as a real autonomy regression gate: KOTA's autonomy
workflows should be covered by fixtures cheap enough to run per
autonomy-change, seeded from real past failures, so plumbing
regressions in the load-bearing workflows (decomposer, builder,
improver, research-retry) are caught before they cost a real run.
Keeping fixture-authoring cost flat as new workflows gain replay
coverage is on the critical path for the harness to earn its
regression-gate role.

## Acceptance Evidence

- Diff of `src/modules/eval-harness/recorder.ts` (and any split-out
  judge-extraction helper), `src/modules/eval-harness/cli.ts`,
  `src/modules/eval-harness/recorder.test.ts` (or a new
  `recorder-judge.test.ts`),
  `src/modules/eval-harness/fixtures/builder-agent-call-replay/recordings/critic-review.json`,
  `src/modules/eval-harness/fixtures/builder-agent-call-replay/notes.md`,
  and `src/modules/eval-harness/AGENTS.md` in one commit.
- Transcript of `pnpm kota eval record-agent-step --run-id
  2026-04-24T15-11-48-347Z-builder-gnt9c6 --fixture
  builder-agent-call-replay --judge critic-review` producing the re-
  extracted `recordings/critic-review.json`, captured in the run
  artifact.
- Transcript of `pnpm kota eval run --fixture
  builder-agent-call-replay` passing deterministically with zero
  live-LLM calls after the re-extraction, captured under
  `.kota/runs/<run-id>/`.
