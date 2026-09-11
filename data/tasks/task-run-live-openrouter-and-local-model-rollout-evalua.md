---
status: blocked
priority: p1
depends_on: [task-extend-harness-parity-and-eval-harness-with-model-, task-add-scaffolded-weak-and-local-model-agent-mode]
---
# Run live OpenRouter and local model rollout evaluation

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

The task remains unfinished in the active queue, marked blocked under the
builder's required lifecycle rule. This records the concrete external
precondition while preserving the task's intent that a skip cannot count as
completion. Production presets and operator recommendations are unchanged.

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

## Current disposition (2026-09-10)

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

## Blocked on

kind: operator-capture
path: .kota/runs/*
description: Attributable readiness evidence from a runtime-authorized contained evaluation context able to use Docker, discover/install a local model, and use existing provider credentials through their owners. Native/local routing also requires the implementation below.

The path is a discovery hint; equivalent scoped probes or exports are valid.
Existing run directories and historical host checks do not establish readiness
in the evaluation context. Review execution provenance and successful isolation,
egress/auth, baseline, and local-runtime readiness before reopening through the
normal task operation. Collection is already authorized; no renewed permission
or manual operator capture is required when scoped collection is available.

A runtime-authorized contained evaluation context with access to Docker, local
model discovery/install, and owner-mediated use of the existing provider and
native baseline credentials. This agent's current filesystem/network policy
prevents those scoped operations, despite the task's existing authorization.
External readiness alone cannot resume the full matrix. Complete the native/local
routing implementation below, then establish a compatible isolated image and working egress/auth,
installing an appropriate local model within measured capacity, and running the
preserved cohort with comparable evidence. Do not expose deployment secrets or
grant candidate code host authority. The shared whole-container provider-egress
policy is still non-gating and must satisfy the required evidence/boundary
conditions before model promotion. A preflight skip does not complete this task.

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
- Independently resolve the external execution-context access described in
  Blocked on. Access to Docker, host auth, or a populated Ollama server alone is
  insufficient. The task stays blocked for that external precondition and remains
  unfinished for the two internal routing requirements; containment is not their
  implementation and does not complete the rollout task.

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

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-11T06:22:46.511Z -->
