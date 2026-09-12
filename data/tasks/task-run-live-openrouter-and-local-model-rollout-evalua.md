---
status: blocked
priority: p1
depends_on: [task-extend-harness-parity-and-eval-harness-with-model-, task-add-scaffolded-weak-and-local-model-agent-mode, task-enable-runtime-mediated-contained-evaluation, task-complete-contained-evaluation-host-setup]
---
# Run live OpenRouter and local model rollout evaluation

## Current Contract

Native/local routing and the contained Codex proxy handoff integrated in
`3835edb0f`. The shared invocation gap is assigned to
`task-enable-runtime-mediated-contained-evaluation`; consume that capability
rather than creating another bridge. Finish image, egress and model setup, then
run the live comparison. Existing credential resolution is implementation
work; an empty local model inventory is setup work. Use available owner-mediated
auth and isolated execution, reporting any genuinely unavailable credential or
entitlement precisely. Historical sandbox denials do not justify deferring these
changes or imply host absence. Keep the full cohort, comparable metrics, exact
Codex baseline, 90% pass^k/no-P0 promotion gate and denied unintended access.
No live row, supported tier or replacement claim follows from a preflight skip.

This contract supersedes historical blocking and operational-capture requirements.


## Problem

After the provider and harness parity work lands, KOTA still needs an evidence
run before changing defaults or recommending OpenRouter/local models. Public
benchmarks are not enough because they measure different harnesses, prompts,
tools, and environments. The owner wants practical performance in KOTA, not a
model leaderboard summary.

## Desired Outcome

KOTA runs the completed model matrix against Codex baselines and records a
support-tier decision. The result names which models are supported for capable,
balanced, fast, weak/local scaffolded, and rejected use; it also names the
remaining blockers for models that are close but not ready.

## Constraints

- Do not promote any OpenRouter or local model to a recommended default unless
  the matrix evidence meets the acceptance threshold.
- The capable replacement candidate must reach at least 90% of Codex `pass^k`
  on the selected KOTA scenario suite and have no P0 feature-parity failures.
- Secondary candidates can be marked supported for narrower tiers only when
  the report names the task class, pass^k, cost, latency, and feature limits.
- If `OPENROUTER_API_KEY` or local runtime prerequisites are absent, record a
  preflight skip and keep the task unfinished. Use blocked for an unavailable
  external prerequisite; a skip is not rollout evidence.
- Keep the final decision in the task result and run artifact. Do not create a
  parallel benchmark catalog or external leaderboard doc.

## Done When

- The matrix includes Codex/GPT-5.5 baseline rows and candidate rows for at
  least GLM-5.2, Kimi K2.7 Code, DeepSeek V4 Pro/Flash, Qwen 3.7 Plus, MiniMax
  M3, MiMo V2.5, and one local or local-like weak model route.
- Each candidate has pass@k, pass^k, cost, latency, token usage, turn count,
  tool count, approval count, context-retrieval diagnostics, trajectory
  diagnostics, and verifier output recorded.
- The rollout decision marks each candidate as `supported`, `experimental`,
  `scaffold-only`, or `rejected`.
- Presets or operator guidance are updated only for `supported` candidates.
- The task result explicitly states whether KOTA can currently run without
  Codex/Claude for the selected task classes and what remains before broader
  replacement.

## Source / Intent

The owner asked to run candidates in parallel with Codex, look at real
performance, tune directions for weaker models, and reach a future state where
KOTA can be run without Codex or Claude when evidence supports it. This task is
the empirical decision point after the enabling work is complete.

## Initiative

OpenRouter/local model parity for KOTA autonomy.

## Acceptance Evidence

- `.kota/runs/<run-id>/` contains the live model-matrix artifacts, preflight
  records, per-scenario transcripts, verification output, aggregate report, and
  support-tier decision.
- `pnpm run validate-tasks` passes after the task records its outcome or moves
  follow-up blockers into the queue.
- If supported presets are changed, `pnpm run test:preset-parity` passes or
  records valid auth/runtime skips for every affected preset.

## Result — 2026-09-09 preflight skip

Outcome: preflight skip; rollout decision deferred. No live inference, scenario,
fixture, or verifier ran. No candidate is promoted or rejected on this evidence.
KOTA's ability to replace Codex/Claude for any task class remains unestablished
by this run.

The process has no OPENROUTER_API_KEY. The active filesystem policy denies
scope secret files, so the scope resolver was not invoked. This does not
contradict the historical September 8 authentication success or establish that
the host lacks a key. Both default local model-list endpoints (Ollama on 11434
and LM Studio on 1234) returned fetch failure with EPERM. This establishes an
execution-context restriction, not an absent server or an incapable model.

rollout-preflight.json records the timestamped observations and the shipped
candidate set, including every required OpenRouter candidate. The canonical
catalog freshness validator accepted the June 26 metadata; current provider
availability was not checked. No local model was discovered or guessed.
All performance metrics and support tiers are unavailable, rather than zero
or fabricated classifications.

That attempt recorded an unfinished, blocked disposition under the then-current
lifecycle rule. It supplied no rollout evidence and changed no production presets
or recommendations; the current contract supersedes that disposition.

Resume in a runtime-authorized evaluation context with access to the existing
OpenRouter credential, native Codex baseline execution, and an identified local
model endpoint. Use the shared matrix path with compatible provider/harness
routing, paired scenarios and eval fixtures, sequential repeats, and comparable
resource/configuration evidence. Record all requested metrics and verifier
artifacts before assigning supported, experimental, scaffold-only, or rejected
tiers. A capable replacement still requires at least 90% of baseline pass^k and
no P0 feature-parity failures; narrower support requires measured task-class
consistency, cost, latency, and feature limits.

Evidence: builder run 2026-09-09T15-01-01-382Z-builder-4endrv,
runtime agent artifacts rollout-preflight.mjs, rollout-preflight.json, and
rollout-decision.md. Task integrity validation is retained in validate-tasks.txt.

## Historical disposition (2026-09-10)

Reopened for an internal execution gap before the empirical matrix. In
harness-parity/model-matrix-eval.ts around line 209, the eval executor hardcodes
host subprocess isolation although the selected fixtures require containers.
Route the matrix through the existing eval execution/isolation configuration and
credential owner; do not add a parallel executor or bypass fixture isolation.
Prove required isolation reaches real candidate launches and missing capability
is reported before consuming inference. Preserve the exact GPT-5.5 baseline,
candidate rows, comparable repeats, metrics and 90% pass^k/no-P0 acceptance.

Host check today: the existing deploy/telegram-assistant/.env OpenRouter
credential returned HTTP 200 at the read-only authentication endpoint, while
normal scope resolution found none. This is authorized credential routing work,
not a request to buy or paste a new key. Never copy secrets into task/run artifacts
or broadly expose deployment secrets to agents. Ollama is reachable with zero
models installed; LM Studio is not listening. The old blanket EPERM description
is historical, not current host readiness. Docker works, but the internal
OpenRouter network currently has no attached containers and its proxy is stopped.

Fix shared execution/routing first. Establish a compatible isolated image and
egress/auth readiness before live rows, using existing owners and already granted
Docker permission. Identify/install an appropriate local model within available
host capacity through its normal local runtime; do not fabricate local parity or
substitute a cloud row. Preserve real missing credentials/model availability and
unrun evidence as explicit remaining acceptance, not as grounds to defer code
that can be corrected now. Keep Codex production defaults unchanged.

## Result — 2026-09-10 isolation repair and blocked live evaluation

Repaired isolation configuration propagation; native authentication and local
endpoint routing remain unimplemented (see remaining implementation below).
Matrix CLI/HTTP requests now carry
provider-specific eval-harness isolation settings into the existing subprocess
executor. Source-scope provider credentials and selected harness boundary facts
reach candidate launches; host login locators stay out of containers. Every
runnable eval route preflights before scenario inference. Missing image,
backend, or verifier isolation stops the matrix with persisted evidence;
provider mismatches reject before launch. Scoring remains offline and existing
non-gating egress remains non-gating. No production preset changed.

No live inference ran. `rollout-preflight.json` records the exact Codex/GPT-5.5
baseline, all seven required OpenRouter models (including both DeepSeek variants),
and a provisional Ollama Qwen2.5-Coder 3B install target. It pins a scenario/fixture
cohort and three planned sequential repeats; all performance measurements and
support tiers remain unavailable. The local model was not discovered/installed
and its capacity/suitability is unmeasured. The normal Ollama pull command failed
at the denied connection. Raw/scaffold evaluation remains outstanding.

Docker info/image inspection and Ollama/LM Studio endpoint access were denied in
this execution context. This does not contradict today's recorded host readiness
or existing-key authentication success. No scope/deployment secret was read by
the readiness probe; the process has no OpenRouter key. No absent host credential,
absent Docker service, or incapable candidate is inferred from these denials.
A compatible image, provider egress/auth, and native baseline execution remain
unverified. The current metadata resolver also leaves exact GPT-5.5/local
capability evidence unavailable; that evidence must be collected before gating.

No candidate is promoted or rejected. Whether KOTA can run without Codex/Claude
for the selected task classes remains unestablished. The original 90% of Codex
pass^k/no-P0 criterion and narrower-tier measurement requirements are preserved.

Validation: `pnpm check:fast` passed, including production/test typechecks, lint,
task validation, and generated bindings. Six matrix owner tests passed through
HTTP routing, the shared subprocess launcher with a controlled Docker port,
calibrated offline scoring, sequential repeats, credential isolation, and
pre-inference rejection. A final focused test also verifies that host login
locators never enter candidate containers. The broader owner selection passed
81 other files; its unrelated dependency-scan failure remains the existing
autonomy security-review test-support import of codex-agent-harness. These are
implementation proofs, not live rollout evidence. CLI help and malformed-isolation
rejection are retained as rendered operator transcripts.

Evidence: builder run `2026-09-10T02-03-15-941Z-builder-2zxsrj`, runtime `agent/`
artifacts `rollout-preflight.json`, `readiness/eval-preflight/`,
`rollout-decision.md`, `local-model-install.txt`, `matrix-eval-tests.txt`,
`matrix-auth-isolation-test.txt`, `owner-tests.txt`, `check-fast.txt`,
`matrix-cli-help.txt`, and `matrix-cli-invalid-isolation.txt`.

## Repair review — unsupported routes contained

The earlier result overstated execution readiness. Docker readiness and existing
host credentials do not make the native baseline executable: the eval container
has a fresh HOME, host login locators are intentionally excluded, and Codex strips
OPENAI_API_KEY. The matrix now rejects native container login before any candidate
or scenario inference, records the routing issue separately from resource/verifier
readiness, and does not resolve an unrelated provider key for a native adapter.

Ollama and LM Studio container rows now likewise reject before inference. Their
model-client defaults address container localhost; offline containers cannot reach
the host server, and the shared egress schema has no local-provider policy.
Installing a model on the host does not repair this implementation gap. The
rejection retains isolation and does not substitute host execution or a cloud row.

### Remaining implementation and acceptance

- Implement owner-mediated contained native login through the native adapter and
  eval isolation owners, preserving the exact Codex/GPT-5.5 baseline. Prove actual
  authentication and credential containment; an OpenAI API key is not that proof.
- Implement contained local endpoint routing through eval isolation and the
  model-client owners, including endpoint propagation, supported network policy,
  and positive inference plus denied unintended access. Then discover/install a
  suitable local model within measured host capacity and run raw/scaffold rows.
- Establish supported contained execution after implementing the routes. Access
  to Docker, host auth or a populated Ollama server alone is insufficient.
  Containment-by-rejection is not working routing; validate positive inference
  and credential/network confinement before the empirical rollout decision.

All original candidate, metric, equal-repeat, 90% baseline pass^k/no-P0, and tier
requirements remain unchanged. No live inference ran, no support decision is
claimed, and Codex production defaults remain unchanged.

Repair verification: nine focused matrix owner tests passed, including ready
container cases for native login, Ollama, and LM Studio that reject with no
candidate/scenario launches or host-login resolution. The controlled OpenRouter
launch, sequential repeats, offline scorer, missing-isolation, and schema rejection
cases still pass. These establish containment and retained behavior, not live
routing or model quality. Repair-specific static checks and operator preflight
results are recorded in the run summary and repair2 artifacts.

## Result — 2026-09-12 contained routing and preflight skip

Added the native login handoff and local endpoint selection through the existing
adapter, eval subprocess, and model-client owners. The Codex adapter declares a
single login-file locator. The executor checks readability before inference,
snapshots only that file outside the candidate workspace, supplies a read-only
container mount, and removes the snapshot after execution. Host homes, sessions,
configuration, and original writable credentials are not mounted. The existing
native permission profile denies the source credential and runtime home to tools.

Ollama and LM Studio now have provider-egress policies using the existing internal
proxy boundary. The model-client owner supplies their contained endpoints and
rejects mismatched providers or explicit endpoint overrides before client creation.
Matrix admission requires matching egress and the adapter's contained auth contract.
Scorers remain offline. These are routing changes, not demonstrated live login,
model inference, or a supported image/proxy deployment. Existing egress evidence
remains non-gating; network labels do not establish denied unintended access.

The persisted probe again observed Docker socket permission denial and EPERM from
both local model-list endpoints in this execution context. No scope/deployment
secret or native login file was read. No host credential absence, empty host model
inventory, unavailable host Docker service, or missing model entitlement is inferred.
No exposed tool provides an alternative owner-mediated evaluation execution/export
capability here. The deployment credential has not been rebound through the scope
secret owner; the historical authentication success remains valid historical evidence.

No live inference ran. `rollout-preflight.json` retains the exact Codex/GPT-5.5
baseline, the complete shipped OpenRouter candidate set (including every required
model), and unresolved local raw/scaffold routes. It records ten scenario and four
fixture manifest hashes with three planned sequential repeats. The provisional
Qwen2.5-Coder 3B install target is not an installed/discovered model or a measured
capacity recommendation. All requested quality, usage, cost, latency, activity,
retrieval, trajectory and verifier measurements remain unavailable, as do support
tiers. No model is promoted or rejected; production presets and recommendations
are unchanged. KOTA's ability to replace Codex/Claude remains unestablished.

Verification: `pnpm check:fast` passed; the production build passed. Twenty focused
routing/matrix tests passed, covering login snapshot permissions and cleanup,
candidate-controlled/absent login rejection, native/local launch propagation,
endpoint mismatch rejection, and existing pre-inference matrix failures. A broader
nine-file owner selection passed 188 tests for subprocess execution, provider
configuration, native credential denials, and module registration. Three launch
cases overlap those selections; counts are not independent quality samples. These
use controlled subprocess/provider ports, not live Docker or authentication.
The CLI help transcript and timestamped readiness transcript are retained. A
resumed invocation initially lost its temporary test cache; rerunning with a
run-owned temporary directory passed. No failed check is counted as a live row.

Critic repair corrected the execution owner to accept an explicitly empty provider
credential list while rejecting missing or malformed metadata. Shell, process and
REPL share that boundary; inherited proxy filtering remains active after caller
and session overlays. A real shell launch and environment assertions exercise the
credential-free path. CLI and JSON provider validation now use the same endpoint
registry, so standalone eval accepts Ollama and LM Studio and rejects unknown
providers before dispatch. The repair selection passed 93 tests across seven files,
covering these outcomes and existing shell, process, REPL and provider behavior;
`pnpm check:fast` passed after import ordering was corrected. These are deterministic
checks, not live local inference or proof of network isolation. The live rollout
prerequisite and all unavailable measurements below remain unchanged.

The second critic repair aligned contained OpenAI egress with Codex login renewal.
The adapter now owns one endpoint declaration consumed by its native launcher and
the eval policy, including `auth.openai.com`; eval declares the module dependency.
A controlled container launch verifies the refresh endpoint in the observed profile
and child environment, and a network declaration omitting renewal is rejected
before launch. Existing adapter verification retains the native endpoint contract.
The selected five-file owner suite passed 158 tests, and the provider-egress launch
regression passed one test. `pnpm check:fast` passed. Production TypeScript emission
passed into the run-owned `repair2-compiled` directory. The full `pnpm build` attempt
failed while removing existing `dist` directories with filesystem permission denials;
asset packaging was not rerun successfully in this repair. No live token refresh,
inference, or confinement claim follows from these deterministic checks.

The third critic repair preserves the trusted inherited upstream-proxy setting in
Codex's explicit native environment projection. A cross-module integration test
now passes the production eval container environment through the real Codex adapter
with ordinary workflow overrides and checks the native-launch boundary. The proxy
and login locator survive; unrelated credentials and ordinary proxy variables do
not. The controlled launcher rejects before execution, so this proves the missing
handoff without simulating authentication or sandbox transport. That integration
case passed, as did 24 adapter/container tests, static checks, and production
TypeScript emission to `repair3-compiled`. The broader owner selection had 20
failures caused by this invocation's restrictions: four proxy/sandbox cases could
not listen on loopback (EPERM), and sixteen native configuration-authority cases
could not read the canonical package manifest (EPERM). They are not counted as
passes; live proxy chaining, refresh, inference and confinement remain unverified.
The shared native sandbox still owns upstream validation, chaining and removal of
the control marker before CLI launch; no host credential or network grant changed.

Evidence is in builder run `2026-09-12T06-41-11-663Z-builder-drp743`, runtime
`agent/`: `rollout-preflight.mjs`, `rollout-preflight.json`, `rollout-preflight.txt`,
`rollout-decision.md`, `routing-tests.txt`, `owner-regression-tests.txt`,
`check-fast.txt`, `build.txt`, `matrix-cli-help.txt`, `validate-tasks.txt`,
`repair-routing-tests.txt`, `repair-check-fast.txt`, `repair2-egress-tests.txt`,
`repair2-egress-regression.txt`, `repair2-check-fast.txt`, `repair2-build.txt`,
`repair2-compile.txt`, `repair2-validate-tasks.txt`, `repair3-handoff-tests.txt`,
`repair3-owner-tests.txt`, `repair3-check-fast.txt`, `repair3-compile.txt`, and
`repair3-validate-tasks.txt`.

## Result — 2026-09-12 runtime-mediated profile inspection

The shared mediation dependency is archived done, and this invocation reached the
trusted host through `pnpm kota eval contained '{"operation":"inspect"}'`.
The host returned a tool error: `Set KOTA_EVAL_CONTAINED_PROFILES in the trusted
host environment`. Both inspection calls exited 1 with this same diagnostic;
the second call's timestamped transcript and tool-use identity are retained.
This supersedes the earlier observation that no mediation surface was available.

No profile was returned, so no image, provider, fixture, or candidate execution
was requested. This is a specific host configuration prerequisite, not evidence
of missing credentials, unavailable Docker, an empty local inventory, or model
incapability. The supplied issue-evidence export contains historical runs through
the preceding routing repair, not a new live evaluation cohort.

No live inference, live verifier, or quality measurement ran. The preflight artifact retains
the exact Codex/GPT-5.5 baseline, all seven required OpenRouter candidates, and
unresolved local raw/scaffold rows, with three planned sequential repeats. It
inventories current scenario and fixture manifest hashes; it does not claim an
executed or fully snapshotted cohort. All requested measurements and support tiers
remain unavailable. No candidate is promoted or rejected and no preset is changed. The initial
disposition changed only task data; the critic repair below implements the missing
contained matrix route. Replacement of Codex/Claude remains unestablished.

Evidence: builder run `2026-09-12T14-17-38-986Z-builder-7pjlah`, runtime `agent/`
artifacts `contained-inspect.txt`, `rollout-preflight.json`, and
`rollout-decision.md`. Task integrity validation is recorded in
`validate-tasks.txt`. These establish the returned setup failure and task-data
integrity only; they are not live model or containment proof.

## Next execution

This is open work behind `task-complete-contained-evaluation-host-setup`, which
owns the missing deployable host grants and shared setup journey. Missing
operator-capture files are not an external prerequisite. Do not repeat a
task-only blocked receipt for the same unfinished setup. The coordinator owns
host activation; this task owns the actual comparable model measurements after
activation, with the original quality and containment requirements intact.

The trusted host must supply scope-authorized `KOTA_EVAL_CONTAINED_PROFILES`
through its existing environment configuration owner. The profile contract in
`src/modules/eval-harness/contained-evaluation.md` binds scope, preset, allowed
fixtures/candidates, repeats, image, restricted provider egress, deadline, CPU,
and memory. Worker requests cannot install or widen these host grants, and this
builder must not control its parent daemon. This is not a dependency wait or a
request for new credentials or manually captured benchmark results.

The critic repair implements the general matrix action now, independently of this
host prerequisite. After profiles are available, inspect the exact grant with
`pnpm kota harness-parity contained '{"operation":"inspect","profile":"rollout"}'`
and execute it through the same command's `run` operation. Finish OpenRouter
credential binding, compatible image/proxy setup, exact native baseline
authentication, and local model discovery/setup within measured capacity through
already authorized scoped setup. The host image must contain the matching CLI.
Publication and activation belong to runtime and do not defer source work here.

Establish positive native/local inference and denied unintended credential/network
access, then pin and execute the comparable cohort with equal repeats and all
required metrics/verifiers. Preserve the exact GPT-5.5 baseline, 90% pass^k/no-P0
promotion gate, narrower-tier requirements, and explicit non-gating evidence.

## Critic repair — contained matrix composition

The initial blocked disposition deferred actionable implementation. That gap is
now repaired in harness-parity and the shared eval executor. The new native
`contained_model_matrix` action uses the existing authorization service, scoped
host profiles, blocking worker and process/resource cleanup. It binds exact
model/adapter pairs (including native baseline and local raw/scaffold), scenarios,
fixtures, repeats and resources on the host. Requests cannot widen that grant.
The existing matrix owner still assembles paired rows, metrics and reports.

Scenario agents now use the shared container launch/auth owner through an
image-local real harness command. Candidate session state uses a disposable scope
and is removed before scoring. Verifiers and diff commands execute in offline
containers; shipped scenario declarations identify immutable scorer overlays.
Missing declarations, relocated scorer files, candidate runtime-path symlinks,
malformed stage evidence and failed container preflight reject visibly. No host
candidate execution or alternate authority bridge was added.

Nine focused tests passed: paired scenario/fixture repeats exercise production
materialization, scoring, report and cleanup owners with a controlled subprocess
port; other cases cover exact native/local route preparation, scope/grant
rejection, cancellation, verifier protection, malformed evidence, runtime-path
safety, and the real image command-to-harness handoff. This is deterministic
composition proof, not live OCI, authentication or model-quality proof.
`pnpm check:fast` passed. The broader owner selection passed 119 tests and failed
six launch cases; a direct production process probe reports `/bin/ps EPERM`.
The final full build could not remove existing `dist` directories (Operation not
permitted); separate production compilation provides scoped source proof. These
limitations remain explicit in the run summary and do not count as passes.

A fresh authorized host inspect still returned the unset-profile diagnostic
(tool use `tool-e193855f5a4022c6044ba42f1ab6f029`, exit 1). This confirms the
remaining external prerequisite without inferring host credential or model
absence. The task remains blocked solely on that host-owned configuration;
its live acceptance remains unmet, and no rollout recommendation changes.

Repair evidence is retained in the same run's `agent/`: `repair-matrix-tests.txt`,
`repair-owner-final.txt`, `repair-process-probe.txt`, `repair-check-fast.txt`,
`repair-build.txt`, `repair-compile.txt`, `repair-contained-inspect.txt`, `repair-contained-help.txt`,
`repair-validate-tasks.txt`, and the updated `rollout-decision.md`. Review copies
under `.kota/runs/2026-09-12T14-17-38-986Z-builder-7pjlah/evidence/` preserve these
original observations; copying them does not establish a new execution cohort.


## Result — 2026-09-12 integer admission repair and host-grant preflight

Run `2026-09-12T19-11-36-284Z-builder-rbfe3x` reached both native inspection
surfaces. Matrix inspection failed before its runner: the shared JSON Schema
validator rejected the CLI's default integer repeatCount of 1 as a JavaScript
number (`tool-967b093ac16c03867cbd460aab88f0a8`). Repaired the shared validator
to recognize integer-valued numbers, including nullable integer unions, while
retaining rejection of fractional and string inputs. Ordinary number schemas
still accept both integer and fractional values. Domain positive-count and
host-repeat-limit checks remain with the existing contained request/profile owners.

The independent `eval contained` inspection reached the trusted host and returned
`Set KOTA_EVAL_CONTAINED_PROFILES in the trusted host environment`
(`tool-ce35559916026d378811f2561ce7e2f3`). The completed setup dependency provides
the deployment recipe and installation owner; it does not establish activation.
No profile was returned, and no model, image, fixture or verifier was launched.
The integer repair is source work for runtime publication; this invocation does
not claim the parent host has loaded it. No daemon lifecycle operation ran.

The cohort artifact records the exact native Codex/GPT-5.5 baseline, the full
shipped OpenRouter candidate set and local Qwen2.5-Coder 3B raw/scaffold routes,
three planned equal repeats, and hashes of the recipe's scenario/fixture source
files. These are current source observations, not an installed host grant or an
executed cohort. The setup dependency's September 12 local inference and model
digest remain historical readiness evidence; no reinstall or empty-inventory
claim is made. No host credential absence or provider unavailability is inferred.

All requested live quality, cost, latency, usage, activity, retrieval, trajectory
and verifier measurements remain unavailable. Support tiers are unassigned;
no supported, experimental, scaffold-only or rejected verdict follows from this
skip. No preset or recommendation changes. Whether KOTA can replace Codex/Claude
for any selected task class remains unestablished. Comparable equal repeats,
90% of native baseline pass^k, no P0 parity failures, and live positive inference
plus denied unintended credential/network access remain required.

Verification: the pre-fix regression reproduced integer rejection at both tool
input and structured-output boundaries (two failures). After repair, the tool
schema, contained matrix and contained probe suites passed 22 tests. A second
selection passed 22 schema and workflow-payload tests; five schema tests overlap,
so these are 39 distinct deterministic cases, not quality samples. They prove
admission/rejection, existing grant limits, paired execution/report assembly with
a controlled process port, and payload compatibility. `pnpm check:fast` passed.
The final task validator is retained separately. No live OCI, authentication,
network confinement, preset parity or model-quality check is claimed.

Evidence under this run's runtime `agent/`: `contained-inspect.txt`,
`contained-profiles-inspect.txt`, `integer-regression-before.txt`,
`integer-regression-after.txt`, `schema-owner-tests.txt`, `check-fast.txt`,
`rollout-cohort.json`, `rollout-decision.md`, and `validate-tasks.txt`.

## Blocked on

```
kind: operator-capture
path: .kota/runs/
description: Trusted-host activation of the reviewed scope-bound rollout profile, observable through the existing native contained inspection; equivalent attributable host readiness clears this prerequisite without manual captures.
```

The path is an evidence-discovery hint under the existing task vocabulary, not a
required capture destination or a request for benchmark results. A fresh native
inspection returning the authorized profile is sufficient to resume execution.

The trusted host must activate a reviewed scope-authorized `rollout` profile
through the completed deployment recipe and existing service owner. The current
host explicitly reports its profile environment unset. This is host configuration,
not a request for another credential, local-model installation, manual result
capture, or another implementation task. Builders cannot install host grants or
control their parent daemon. After activation, use the existing native inspection
and run actions with three repeats, establish actual image/auth/proxy readiness
and positive/negative containment, then collect and judge the full matrix.
Runtime publication carries the integer repair independently of this prerequisite.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-12T20:04:50.473Z -->
