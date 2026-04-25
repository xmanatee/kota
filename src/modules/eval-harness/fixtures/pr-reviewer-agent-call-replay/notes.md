# pr-reviewer-agent-call-replay fixture

End-to-end replay of pr-reviewer's `review` agent step plus the new
`external-call-log` predicate kind and fake-binary shim mechanism. The
fixture is the first consumer of both primitives; it locks the predicate
contract, the shim's PATH-prepend wiring, and pr-reviewer's
`outputFormat: "json"` + emit-step path against future regression.

## Why this fixture is a smoke fixture

pr-reviewer fires only on `github.pull_request` webhooks, and KOTA's own
dogfood loop has not produced a real pr-reviewer run on this branch yet
(0 runs in `.kota/runs/`). With no real failure to encode, the fixture's
honest provenance is `smoke-fixture`. The recording's response text and
file operations are synthesized from the workflow's known shape — the
prompt's required JSON verdict block plus the shape of the `gh pr
review` invocation the agent's prompt describes — so the harness
plumbing the fixture exists to lock is exercised end-to-end without any
made-up real-failure claim.

When the first real pr-reviewer failure lands, retire this smoke
fixture, capture the source run via `pnpm kota eval record-agent-step
--run-id <id> --step review --fixture pr-reviewer-agent-call-replay`,
and flip `provenance.kind` to `real-failure` with the captured
`sourceRunId`. Until then, the smoke fixture's justification is the
load-bearing honesty contract.

## Shape

- `initial/` is intentionally minimal. pr-reviewer has no repair loop,
  no commit step, and no read of `data/` or `.kota/runs/`; the only
  fixture-side scaffolding it needs is a stub `package.json` (so any
  incidental shell-out the runtime may make does not error) and a
  `.gitignore` that mirrors the repo-root unignore rule for nested
  fixture `initial/.kota/` trees.
- `triggerPayload` carries the github.pull_request webhook fields
  pr-reviewer's `assess-pr` step inspects (`repo`, `action`, `number`,
  `title`, `headBranch`, `baseBranch`, `isFork`) plus `_runId`, the
  runtime-pinned run-directory id used by the metadata predicates so a
  regression renaming the run dir is caught loudly without globbing.
- `externalCallShims: ["gh"]` opts in to the new fake-binary shim
  mechanism. The runner installs a Node-script shim at
  `<workingDir>/.kota/shims/gh` and prepends that directory to `PATH`
  for the subprocess. Replay-mode agent steps never actually invoke
  the shim — the recording's `fileOperations` writes the same JSONL
  shape the live shim would produce — so the shim mechanism is
  dormant during this fixture's replay path but installed and ready
  for any future live-LLM pr-reviewer fixture for the same workflow.
- `recordings/review.json` carries the synthesized agent response for
  the `review` step. The response text ends with a fenced JSON block
  containing `{"recommendation":"approve"}` so the workflow's
  `outputFormat: "json"` + `outputSchema` extraction produces a typed
  step output the `emit-review-posted` step can read.

## Predicate rationale

The fixture exercises two new harness surfaces and the existing
emit-event surface together:

- Two `external-call-log` predicates against `gh`: one with
  `argv-prefix ["pr", "review"]` to assert the meaningful subcommand
  shape, one with `argv-includes "--approve"` plus `exitClass: "zero"`
  to assert both the verdict argv and the recorded exit code class.
  Together these cover all three argv-match shapes (prefix, includes,
  and — via the focused unit tests in `predicates.test.ts` — equals)
  the new predicate kind exposes.
- `file-contains` against `.kota/external-calls/gh.jsonl` directly
  asserts the recorded JSONL line's argv shape. This is the byte-level
  evidence that the shim's log format and the recording's file-op
  format agree, so a regression in either side trips a different
  predicate than the structural `external-call-log` matchers.
- Two `file-contains` predicates against the pr-reviewer run's
  `metadata.json` assert the `review` agent step succeeded and the
  `emit-review-posted` step succeeded. Without these, a regression in
  either step's success path could leave the gh call recorded but the
  workflow run failed, and the fixture would still pass on the
  external-call assertions alone.
- One `run-emits-event` predicate asserts the bus event the workflow
  emits (`workflow.pr.review.posted`) actually fired with the expected
  payload (`prNumber`, `repo`, `recommendation`). This is the
  end-to-end seam between the agent step's structured output and the
  downstream consumer (the runtime queue / attention digest); the
  workflow's `outputFormat: "json"` + `outputSchema` declaration is
  what makes the emit step's `recommendation` read possible at all,
  and this predicate is what locks that path.

## Cost shape

The healthy case never invokes an LLM: `assess-pr` is a code step,
`review` is replayed from the synthesized recording, and the gh call
is simulated by the recording's file-op write. Subprocess startup,
module loading, and three small step executions complete well under
the declared 60s budget on the standard pnpm-test smoke profile.

## Future shape

If the operator captures a real pr-reviewer source run (e.g. by
authoring a dogfood PR and letting the workflow fire), promote this
fixture in three steps:

1. `pnpm kota eval record-agent-step --run-id <id> --step review
   --fixture pr-reviewer-agent-call-replay` — overwrites the
   recording in place with the captured response envelope plus any
   real `fileOperations` (run-dir artifacts only; pr-reviewer does
   not commit). The recorded gh invocation in the live run will land
   under `<workingDir>/.kota/external-calls/gh.jsonl` via the shim,
   so the recording's `fileOperations` still writes the same JSONL
   line shape — the recorder may or may not surface that line
   automatically depending on whether the live run's gh call hit the
   shim path; if it did not, hand-author the line from the captured
   step events.
2. Flip `provenance.kind` to `real-failure` and set `sourceRunId` to
   the captured run id.
3. Update this `notes.md` to drop the smoke-fixture justification
   prose and cite the captured source run id.
