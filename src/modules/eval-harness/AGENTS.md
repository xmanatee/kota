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
- Builder fixtures name `builderTaskId`; the runner resolves its immutable
  dispatch through the production builder task owner after materialization and
  after each round input. Do not copy task digests into fixture data.
- Persistent scenarios use ordered multi-round fixtures.
- Round-input destination writes use verified, pinned directories and atomic
  leaf replacement. Retained candidate symlinks must never redirect host writes;
  lexical path checks alone do not establish filesystem containment.
- Retain a fixture only for a named model-dependent failure and a model/prompt
  decision that deterministic owner checks cannot settle. Record that rationale
  with the fixture. Scorers measure outcomes, not prescribed test names, source
  spelling, implementation paths, or authored reasoning narratives.
- Objective metrics are deterministic evidence, not a second runner. Metric
  errors fail passing runs; failed runs retain diagnostic metrics.
- Scorer self-tests belong to owner verification, never live predicates,
  pre-run expectations, or candidate task completion requirements.
- Verifier calibration runs before the workflow and fails as fixture error.
  Accepted alternatives exist only for deterministic, genuinely broad answer
  spaces.
- Code-health diagnostics are opt-in advisory evidence; predicates own pass or
  fail.

## Baselines And Execution

Cadence stores one accepted aggregate in scope-scoped runtime state. The
first run records without gating; non-gating comparisons advance the baseline,
while gated regressions hold it until a clear run or manual reset. A config
fingerprint change starts a fresh baseline rather than becoming quality signal.

Each run materializes a fresh OS tmpdir and fixtures run sequentially. The
shared `runFixture` plus subprocess executor serves live CLI and cadence runs.
`pnpm test:eval` invokes the live CLI; it is explicit and can incur model cost.
Deterministic harness and scorer checks run in `test:owner`; ordinary `pnpm test`
and `pnpm check` do not invoke models.

Cadence requires its container settings and
`KOTA_EVAL_HARNESS_CADENCE_NETWORK_POLICY`, a JSON provider-egress policy in the
same shape accepted by the eval run API. It uses the provider's declared auth
environment and rejects offline configuration. Scoring remains offline.
CLI runs do not persist cadence baselines. Resource and provider preflight
still determine whether evidence can gate; configuration is not proof of isolation.

Cadence discovery, materialization, subprocesses, and artifact writes declare
daemon-owned blocking operations. Baseline publication uses runtime state
compare-and-set, and events publish only after run success.

## Boundaries

- Keep scoring, runner contracts, cadence baseline, and fixture tooling here.
- Use typed completion/regression events, run artifacts, and one baseline row;
  do not add parallel metrics stores.
- Never leak cost signals into agent context.
- Keep auth behind non-secret adapter locators. Agent replay and binary-call
  shims are unsupported; deterministic product checks belong with their owner.
- Candidate mining is bounded advisory output and never creates fixtures or
  changes regression scores.
- Provider/model evaluations require their declared container, egress policy,
  candidate availability, and artifact evidence; they fail visibly when prerequisites are unavailable.
