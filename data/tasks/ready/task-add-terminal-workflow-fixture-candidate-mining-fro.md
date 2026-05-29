---
id: task-add-terminal-workflow-fixture-candidate-mining-fro
title: Add terminal-workflow fixture candidate mining from KOTA run artifacts
status: ready
priority: p2
area: modules
summary: Scan KOTA run artifacts for terminal-heavy workflow traces and emit bounded eval-harness fixture candidate reports with safety, reproducibility, and state-based verifier signals.
created_at: 2026-05-29T15:27:57.578Z
updated_at: 2026-05-29T15:27:57.578Z
---

## Problem

KOTA's eval-harness already requires fixture provenance, pre-run predicate
sanity, verifier calibration, run-configuration fingerprints, and replayable
agent-step recordings. That protects fixtures once they are authored, but
finding the next useful fixture is still mostly manual: an operator or explorer
must inspect `.kota/runs/`, infer which terminal-heavy workflow traces are
reproducible, and decide whether the trace can become a small state-based
fixture.

This misses an important eval-methodology signal from TerminalWorld. Its
pipeline starts from public terminal recordings, filters out unsafe or
unreproducible sessions, synthesizes outcome-oriented tasks, reconstructs
execution environments, and validates state-based tests against all-passing,
no-op, and partial trials. KOTA should not import TerminalWorld or mine
asciinema, but the same shape exposes a local gap: KOTA has its own run
artifacts and terminal/tool traces, yet no first-party candidate report that
helps fixture authors spot authentic, replayable, state-checkable work from
those artifacts.

## Desired Outcome

The eval-harness module gains an operator-facing fixture-candidate mining
surface over KOTA run artifacts. Given a bounded set of local `.kota/runs/`
directories, it emits a typed JSON report plus a compact human-readable
summary that identifies terminal-workflow candidate traces and explains why
each one is viable, questionable, or rejected.

Each candidate record should be grounded in existing artifacts and include:

- workflow/run identity, task id when available, terminal/tool-call evidence,
  changed paths, verification commands, and final task outcome;
- safety and privacy screening results for command text, env-like values,
  credentials, destructive commands, and external URLs;
- reproducibility signals such as dependency setup, local-only vs networked
  commands, required services, generated artifacts, and host assumptions;
- state-based verifier hints, including persistent output files, structured
  artifacts, objective metric candidates, and no-op or partial-ablation checks
  that a future fixture could use;
- explicit rejection reasons when a trace is too unsafe, too environment-bound,
  too sparse, already covered by an existing fixture, or only meaningful as an
  operator-capture task.

## Constraints

- Keep the work inside `src/modules/eval-harness/` unless a narrow read of
  existing run-store or task helpers is needed. Do not add a parallel benchmark
  runner, external TerminalWorld import, new metrics store, or auto-generated
  task creator.
- Read only local KOTA artifacts. Do not fetch external repositories, scrape
  asciinema, or depend on network access.
- Keep candidate mining advisory. It must not add fixtures automatically, count
  candidates in pass@k/pass^k, or alter cadence gating.
- Use typed parsers for known KOTA artifacts. Malformed internal artifacts
  should surface as explicit skipped/rejected records, not silent coercions.
- Bound report size and redact sensitive-looking values. Do not copy raw
  command output wholesale when a path, command kind, count, hash, or excerpt is
  enough for fixture authoring.
- Reuse existing eval-harness provenance, verifier-calibration, objective
  metric, and replay-recording concepts in the report vocabulary instead of
  creating a second fixture schema.
- Do not weaken the existing real-failure fixture discipline. A candidate
  report is evidence for authoring; a committed fixture still needs normal
  provenance, predicates, pre-run expectations, and calibration where required.

## Done When

- A CLI or existing eval-harness operation can scan a bounded local run set
  (for example by run id, workflow name, time window, or limit) and write a
  deterministic `fixture-candidates.json` plus readable summary under a
  requested run/artifact directory.
- Candidate records classify terminal-heavy traces as `viable`, `needs-review`,
  or `rejected`, with stable reason codes for safety, privacy, reproducibility,
  verifier signal, duplicate coverage, and operator-capture dependency.
- The miner recognizes at least shell/process tool evidence, verification
  commands, task state movement, changed files, and structured artifacts already
  produced by KOTA workflow runs.
- Safety screening redacts secret-like values and rejects or flags destructive,
  network-bound, auth-walled, or host-specific traces before they can be
  recommended as fixture seeds.
- The report names plausible state-based verifier targets and no-op/partial
  calibration ideas for viable candidates without emitting a complete fixture
  spec.
- Focused tests cover viable, duplicate-covered, secret-bearing, network-bound,
  malformed-artifact, and sparse/no-verifier-signal run inputs.
- The local eval-harness `AGENTS.md` is updated if the implementation adds a
  durable candidate-reporting convention.

## Source / Intent

Explorer run `2026-05-29T15-25-05-027Z-explorer-vj21he` started with no
actionable ready/doing work. The only backlog tasks are dependency-waiting on
`task-enable-autonomous-access-to-auth-walled-sources-so`, and every strategic
blocked alternative surfaced by `inspect-queue` is an operator-capture wait,
so none can honestly move today:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-provider-egress-policy-to-containerized-eval-h`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External sources checked:

- `https://arxiv.org/abs/2605.22535` describes TerminalWorld as a benchmark
  data engine that reverse-engineers terminal tasks from in-the-wild terminal
  recordings, yielding 1,530 validated tasks and a 200-task verified subset.
- `https://github.com/EuniAI/TerminalWorld` documents the pipeline stages:
  retrieval/filtering, task synthesis, environment reproduction, and
  state-based test generation/validation with all-passing, no-op, and partial
  trials.
- `https://huggingface.co/datasets/EuniAI/TerminalWorld` exposes the released
  dataset shape and official link back to the paper and repository.

Local overlap check:

- `task-seed-eval-harness-fixtures-from-real-past-kotaruns` and
  `task-seed-eval-harness-fixtures-from-real-failure-runs-` established the
  real-run fixture discipline, but not a candidate-mining report.
- `pnpm kota eval record-agent-step` extracts replay recordings from a known
  source run after a fixture author has already chosen the run.
- `task-add-pre-run-predicate-sanity-checks-to-eval-harnes` and
  `task-add-eval-harness-verifier-calibration-probes` validate fixture
  scoring once a fixture exists; they do not help find authentic fixture
  candidates.
- `task-escalate-persistent-workflow-failure-patterns-into` opens repair tasks
  for repeated workflow failures, not eval-harness fixture seed candidates.

## Initiative

Outcome-grade autonomy evaluation: KOTA should grow fixtures from its own
observable work while giving fixture authors enough structured evidence to
choose authentic, reproducible, state-checkable terminal workflows.

## Acceptance Evidence

- Focused test transcript for the candidate miner and report rendering, for
  example:
  `pnpm test src/modules/eval-harness/fixture-candidates.test.ts src/modules/eval-harness/cli.test.ts`.
- CLI transcript under `.kota/runs/<run-id>/` showing the new scan command run
  against a tiny fixture run set and writing `fixture-candidates.json` plus the
  readable summary.
- Sample report artifact demonstrating at least one viable candidate, one
  rejected unsafe/secret-bearing trace, one network-bound or auth-walled
  rejection, and one duplicate-covered trace.
