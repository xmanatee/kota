# Eval Harness Module

Owns autonomy fixture execution, deterministic scoring, regression gates, and
their CLI, HTTP, and cadence surfaces.

## Measurement Contract

- Record host class, CPU allocation and kill threshold, memory, execution
  backend, requested/observed/enforced profile, timing, and repeat index.
- Host subprocess runs are non-gating without verified CPU and memory facts.
- `pass@k` measures whether any repeat passed; `pass^k` requires every repeat
  and is the regression gate.
- Gate only when baseline and candidate use comparable resources, active
  preset, fixture manifest, source identity, resolved harness/model evidence,
  execution profile, and sufficient equal repeat counts.
- Noise-band drops, profile drift, config drift, or undersized samples produce
  typed non-gating evidence. Calibration is per host class; defaults live in
  code.

## Fixture And Scoring Contract

- Every fixture records either a real failure with its source run id or a
  justified smoke purpose. Anything else fails at load time.
- Fixture ignore rules are stored as `fixture.gitignore`, the package-safe
  canonical name; materialization restores them as `.gitignore` before Git is
  initialized.
- Predicates score final state, never self-report. Initial
  `preRunExpectations` include at least one expected failure.
- Git, shell, agent-verifier, and objective-metric execution uses fail-closed
  offline containers with bounded resources and stripped credentials. Only the
  candidate tree is writable; scorer overlays remain immutable.
- Persistent scenarios use ordered multi-round fixtures. Skill ablations run
  explicit control and treatment variants with prompt/provenance evidence.
- Objective metrics are deterministic evidence, not a second runner. Metric
  errors fail passing runs; failed runs retain diagnostic metrics.
- Verifier calibration runs before the workflow and fails as fixture error.
  Accepted alternatives exist only for deterministic, genuinely broad answer
  spaces.
- Code-health diagnostics are opt-in advisory evidence; predicates own pass or
  fail.

## Baselines And Execution

Cadence stores one accepted aggregate in project-scoped runtime state. The
first run records without gating; non-gating comparisons advance the baseline,
while gated regressions hold it until a clear run or manual reset. A config
fingerprint change starts a fresh baseline rather than becoming quality signal.

Each run materializes a fresh OS tmpdir and fixtures run sequentially. The
shared `runFixture` plus subprocess executor serves three paths:

- the standard-test smoke gate runs representative recorded fixtures once,
  without baseline comparison;
- cadence runs the calibrated repeat count and requires the complete container
  backend for gating; and
- CLI runs are operator-driven and do not persist cadence baselines.

Cadence discovery, materialization, subprocesses, and artifact writes declare
daemon-owned blocking operations. Baseline publication uses runtime state
compare-and-set, and events publish only after run success.

## Recorded Agent Replay

Agent-call fixtures keep one recording per call. The subprocess points the eval
module at a read-only recording root and replaces only the selected harness
slot; production selection remains unchanged.

The adapter expands run-directory placeholders, applies operations inside the
fixture workspace, and stages them for repair checks. Recording provenance must
match the source failure. Workflow prompts route by step identity and judge
prompts by their leading header. Time-sliding placeholders resolve during
materialization before runtime clocks are read.

Replay-only tools are compiled into this trusted module. Local simulated
effects must write through the workflow runner's explicit `cwd`, never the host
process directory; they do not use fixture code, credentials, network access,
or project trust.

## Boundaries

- Keep scoring, runner contracts, cadence baseline, and fixture tooling here.
- Use typed completion/regression events, run artifacts, and one baseline row;
  do not add parallel metrics stores.
- Never leak cost signals into agent context.
- Keep auth behind non-secret adapter locators and replay mocks out of core.
- Candidate mining is bounded advisory output and never creates fixtures or
  changes regression scores.
- Provider/model evaluations require their declared container, egress policy,
  candidate availability, and artifact evidence; they do not fall back to live
  or replay execution silently.
