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
Contained native login locators come only from the registered adapter, never
request bodies. The subprocess owner snapshots the declared login file outside
the candidate tree, mounts it read-only, and removes the snapshot after execution.
Local model endpoint selection belongs to model-clients; eval supplies the matching
internal proxy policy. The shared candidate/probe launcher enables unprivileged namespaces with outer
capabilities dropped, no privilege escalation and a read-only image. Bound
candidates use their workspace UID/GID so private runtime/auth files remain
accessible without DAC capabilities. Images must support the native adapter's nested sandbox
and Node's environment-proxy transport. Positive inference and denied unintended
network/credential access require live verification before rollout claims.

Evaluation CLI numeric options use complete decimal notation: exponent and radix
prefix syntax reject instead of being truncated. Integer options require positive
safe integers; CPU allocations retain fractional values. Optional resource values
remain absent until explicitly supplied.

CLI runs do not persist cadence baselines. Resource and provider preflight
still determine whether evidence can gate; configuration is not proof of isolation.

Cadence discovery, materialization, subprocesses, and artifact writes declare
daemon-owned blocking operations. Baseline publication uses runtime state
compare-and-set, and events publish only after run success.
