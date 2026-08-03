# decomposer-short-circuits-on-non-timeout

## Source

No source run id. This is a smoke fixture. The seeded shape mirrors the
real-failure run id `2026-04-18T15-45-49-339Z-decomposer-zloyo6`
referenced from `fixtures/uncovered/notes.md`, but with the failed
builder carrying no rescopable `errorKind`, so the decomposer's
assess-failure step short-circuits to `shouldDecompose: false` instead
of invoking the agent step. The structured timeout and repair-exhaustion
paths are covered by `decomposer-agent-call-replay` and focused workflow tests.

## What the seeded state pins

- `.kota/runs/2026-04-24T12-00-00-000Z-builder-fxt001/metadata.json` is
  a synthetic failed-builder run whose `build` step has no structured
  timeout or repair-exhaustion `errorKind`, so the classification returns
  no rescoping signal.
- The sibling `task-claim.json` identifies the exact builder-owned task.
- `data/tasks/doing/task-fixture-decomposer-decision-seed.md` is a
  builder-claimed task. If the gate ever lets the agent step run, the
  durable claim identifies this task as the candidate, which lets the
  fixture's predicates catch the regression by observing the file move
  out of `doing/`.

## triggerPayload shape

The `triggerPayload` mirrors the payload decomposer sees in production
when the runtime-dispatch loop enqueues a `workflow.completed` trigger
filtered to `workflow=builder, status=failed`: `workflow`, `runId`,
`runDir`, `status`, `triggerEvent`, `durationMs`, `definitionPath`,
`tags`, `autonomyMode`. It also carries `_runId`, the queue-replay
field that runtime-dispatch (`runtime-dispatch.ts:261`) attaches to
every queued payload before the run-executor reads it. Pinning
`_runId` to a fixed value lets the fixture inspect the decomposer's
own metadata.json at a deterministic path without globbing — the
strongest assertion the existing `file-*` predicates can express
about the decompose step's status.

## Predicate rationale

- `file-exists` and `file-contains` against the seeded
  `data/tasks/doing/...` task assert the file is still in `doing/`
  and its body is byte-for-byte unchanged (canary line). A regression
  that lets the agent step run will overwhelmingly modify or move this
  file, tripping one of these.
- `file-absent` against `data/tasks/dropped/<seed>` is the
  anti-canary for the most likely move target — decomposer's prompt
  moves the original task to `dropped/` after sub-decomposing.
- The four `file-contains` predicates against the decomposer's own
  metadata.json directly assert: assess-failure ran successfully,
  returned `shouldDecompose: false`, and both `decompose` (agent step)
  and `commit` (code step) were skipped. This is the harness's primary
  evidence that the decision gate held — without these, a regression
  that ran the agent step but failed to commit would still pass the
  task-state assertions.

## Cost shape

The healthy case never invokes an LLM: assess-failure is a code step,
and decompose / commit / request-restart are all skipped. The fixture
budget (60 000 ms) covers subprocess start-up, module loading, and the
tiny code-step run. A regression that lets the agent step actually run
will cost a real LLM call once before the fixture trips and the
operator reverts — the cost is bounded to "until the next eval run",
which is the price we accept for catching the regression at all.
