# Builder Workflow

This directory contains the builder workflow definition and its prompt.

- This workflow should own one cohesive normalized task at a time. Resume
  already-active work first; otherwise pull from the short execution queue; only
  promote reserve work when there is no short-queue task to run. Task-state
  semantics live under `data/tasks/`.
- Own implementation quality, architecture, completeness, honest task-state updates, and hard validation fixes before the run ends.
- Tasks define the contract and constraints; the implementing agent owns the detailed plan.
- Changes here shape the default autonomous development behavior.
- Work directly in this repository — no worktrees. Sub-agents must also work without isolation.
- Prefer validation rails over hardcoded pre-agent task moves or scope policing.

## Success Criteria

The builder must declare concrete success criteria before implementation and
verify them before completion:

- `success-criteria.txt`
- `success-criteria-verified.txt`

Number each criterion at column 0 (`1.`, `2.`, ...), one per Done-When item.
The repair check counts numbered items only; column-0 bullets (`- `/`* `) and
prose are treated as notes, so `Design notes` or `Known limitations` sections
do not inflate the criterion count. Match the numbered-item count between the
two files.

Keep completion reviewable. If external resources or runtime behavior matter,
leave enough ordinary context in the task state, docs, code, or run notes for a
later reviewer to verify the result. If a required resource cannot be reached,
record the blocker instead of inferring completion.

## Runtime Probes

The critic inspects the diff, task state, and run artifacts. When success
lives in runtime behavior a diff cannot prove (HTTP route payload, UI
regression, event ordering, daemon runtime misbehavior), a task can declare
an optional runtime probe the critic runs before judging.

- A probe is a typed shell command with a deterministic exit-code predicate:
  exit 0 passes, any other status fails. The probe is the task author's
  declared success predicate for behavior the diff alone cannot prove.
- Default to artifact-only success. Reshape the task to land a test
  assertion, a structured output artifact, or a repo-state change before
  reaching for a probe. Probes should be the exception, added only when
  success genuinely lives outside repo state and no honest artifact-only
  reshaping exists.
- A probe is declared inside the task body as a `## Runtime Probe` section.
  The section body is `key: value` lines, optionally wrapped in a fenced
  code block. Recognized keys: `command` (required) and `timeoutMs`
  (optional, defaults to 120000, capped at 30 minutes). Malformed
  declarations fail loudly — the critic does not silently skip a broken
  probe.
- The critic runs the probe directly via `spawnSync` from its own step,
  the same surface other critic-adjacent checks use. Probes do not route
  through the agent tool loop, so they are not subject to the per-tool
  approval queue. Authors own their commands.
- The probe result lands as `runtime-probe.json` in the run directory and
  is threaded into the critic's prompt with instructions to treat failure
  as a critical issue unless the probe itself is miscalibrated.
- The critic still exercises calibrated judgment. It can accept a failed
  probe when the failure is environmental (network outage, missing binary)
  and unrelated to the staged change, but must justify that in the verdict
  `summary`.
