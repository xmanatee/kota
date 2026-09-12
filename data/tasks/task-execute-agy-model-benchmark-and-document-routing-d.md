---
status: blocked
priority: p1
depends_on: [task-build-reusable-agy-model-evaluation-suite-in-eval, task-enforce-agy-model-readiness-gates-and-dynamic-pres, task-enable-runtime-mediated-contained-evaluation, task-complete-contained-evaluation-host-setup]
---
# Execute AGY model benchmark and document routing decision evidence

## Current Contract

Prepare and validate the current KOTA/AGY image and internal Google egress/auth
route through existing owners, then run the three-repeat comparison. Missing
image/proxy setup is builder work; a verified unavailable provider credential or
entitlement is a concrete blocker. Retain current-model and requested historical
rows, quota and actual effort behavior. Let measured results determine the routing
decision, including needs-more-data or rejection; the historical request to confirm
a preferred model is not permission to force a favorable verdict or switch production.

This contract supersedes historical blocking and operational-capture requirements.


## Problem

The AGY capable preset needs measured long-horizon coding and instruction
adherence results in KOTA. A historical model preference is not evidence of
superiority, and the shipped model has since changed.

## Desired Outcome

Execute comparable scenario evaluations across candidates, retain traces, path
diffs and rubric verdicts, and derive a routing decision from the results.
Keep the historical comparison rows and include the current selected model.

## Constraints

- Store complete evaluation artifacts (scenario definitions, traces, path scope, rubric verdicts, final decision) in the run directory.
- Verify actual model and supported reasoning settings reach the real AGY process
  without silent fallback; intrinsic-reasoning models must not receive unsupported flags.

## Done When

- Run directory under .kota/runs/<run-id>/agy-model-routing/ contains complete scenario traces, changed-path reports, rubric verdicts, and routing decision summary.
- Comparable repeated execution establishes each available candidate's task
  adherence, scope changes, validation results and actual model/effort. Record
  unavailable rows explicitly. A rejected or needs-more-data routing decision is
  valid; success is not conditional on proving a preferred model superior.

## Historical Source / Intent

    Owner direction on 2026-08-07: produce inspectable behavioral evidence confirming Gemini 3.6 Flash as the Antigravity preset default for KOTA autonomy.

Decomposed from `task-validate-agy-model-routing-against-long-horizon-co` after builder run `2026-08-07T01-57-52-891Z-builder-epufuo` exhausted repair.

## Initiative

    Evidence-gated AGY autonomy rollout.

## Acceptance Evidence

- Artifact directory under .kota/runs/<run-id>/agy-model-routing/ containing full benchmark reports and decision documentation.
- Transcript verifying selected model execution at max effort via the real AGY CLI adapter.

## Status (2026-08-11 builder preflight)

The live suite could not start in this builder environment. Docker 29.3.1 is
installed, but the default context has no reachable engine; no configured
Google provider-egress network, proxy, or candidate image is available. AGY
1.1.12 is installed, but `agy models` exits 1, so harness-managed authentication
and `gemini-3.6-flash-high` availability cannot be verified. The screened
preflight transcript and fail-closed `needs-more-data` decision are recorded in
`.kota/runs/2026-08-11T11-04-08-772Z-builder-l9gfun/evidence/artifacts/agy-model-routing/`.

## Historical disposition (2026-09-10)

Host Docker engine and AGY authentication/model discovery now work (Docker
29.3.1, AGY 1.1.27). Remove them as current blockers. The shipped AGY default is
now 3.7 Flash, not the historically described 3.6. Keep the requested 3.6/3.1
comparison, and include the actual selected model before claiming current routing
validation. Do not switch the live Codex daemon to run this benchmark.
Use the existing eval agy-models owner and current container options. Candidate
image/AGY authentication and Google internal egress/proxy still need verification;
there is currently no Google provider-egress network. Intrinsic-reasoning models
must not receive unsupported effort flags. Record unavailable rows and quota
without blind retries. Readiness and model listing do not replace benchmark
traces, repeats, rubric evidence or a routing decision.

## Remaining implementation

The September 12 native worker could not access the Docker socket. The authorized
host check at 08:13 UTC could list Docker images and networks; an old KOTA image
exists, but the Google internal egress network is not provisioned. This is setup
and invocation routing work within the project, not an owner credential block.

`task-enable-runtime-mediated-contained-evaluation` owns the shared callable
evaluation boundary. Consume that capability instead of implementing a second
bridge or granting candidate code host authority. Coordinate shared auth and
local routing with the rollout-evaluation task rather than duplicating its
changes. Produce the current image recipe and restricted Google egress setup
using existing container owners, then execute the prepared comparison.

A denied worker socket must not end another attempt with only the same blocked
receipt while this implementation remains possible. Genuine unavailable provider
credentials, entitlement or quota remain reportable prerequisites. Never label
an unrun benchmark successful or change the live Codex preset to obtain a result.

## Current attempt evidence (2026-09-12)

Run `2026-09-12T06-40-57-819Z-builder-n2rhhp` retained evidence under its
runtime-owned `agent/agy-model-routing/` directory:

- `pnpm build` passed; the compiled KOTA payload, lockfile and dependency policy
  are retained in `kota-build.tar.gz` with a SHA-256 digest. This is build input,
  not a prepared or validated Linux KOTA/AGY container image.
- All 15 tests across four focused AGY eval-owner suites passed. They cover
  runner orchestration, scenario instructions and scoring, and container-only
  availability rejection; they do not measure candidate quality.
- The production fixture loader and instruction-source validator accepted all
  three scenarios. `scenarios.json` and 44 hashed source snapshots retain the
  exact planning, scoped-coding and repair inputs.
- `execution-plan.json` pins source revision `9fb05ca587f8` and includes the
  current `gemini-3.7-flash` plus requested `gemini-3.6-flash` and
  `gemini-3.1-pro`, each at KOTA `max` with three planned repeats per scenario.
  Image/network/proxy names are proposed, not observed infrastructure.
- The real eval availability owner stopped at container preflight with Docker
  socket permission denied (`availability-preflight.json`, `docker-probe.json`).
  It never launched `agy models` or a candidate and did not fall back to host
  execution. Empty available-model output therefore means unobserved availability.

Routing disposition: **needs more data**. Zero scenario repeats ran; model/effort
propagation, quota, rubric verdicts, changed paths, `pass@3` and `pass^3` remain
unmeasured. No production routing change or favorable benchmark claim is justified.
The full three-repeat comparison and image/egress/auth validation remain unmet.

## Current disposition (2026-09-12, runtime-mediated attempt)

Run `2026-09-12T14-17-30-067Z-builder-xqizqf` reached the deployed trusted
eval tool through `pnpm kota eval contained '{"operation":"inspect"}'`.
The host returned tool error `Set KOTA_EVAL_CONTAINED_PROFILES in the trusted
host environment` (tool use `tool-5ddb748d77321d5038316453cb7ec867`).
The shared mediation implementation is available; the missing prerequisite is
its host-owned scope/profile grant. Worker arguments cannot create that grant.
No Docker socket probe, provider credential inference, parent restart, or
production preset change was used to work around this boundary.

Prepared evidence is reviewable in this workspace under
[`.kota/runs/2026-09-12T14-17-30-067Z-builder-xqizqf/evidence/agy-model-routing/`](../../.kota/runs/2026-09-12T14-17-30-067Z-builder-xqizqf/evidence/agy-model-routing/).
The original runtime-owned `agent/agy-model-routing/` packet is preserved.

- [`contained-inspect-response.json`](../../.kota/runs/2026-09-12T14-17-30-067Z-builder-xqizqf/evidence/agy-model-routing/contained-inspect-response.json)
  preserves the actual host response.
- `setup/` contains a current Linux KOTA/AGY image recipe, a Google-only
  CONNECT proxy recipe and internal-network Compose input generated from the
  adapter endpoint catalog, the proposed host profile and invocation, and
  setup/verification guidance. The production profile and request decoders pass.
  These are build/deployment inputs, not a built image or enforced egress proof.
- `kota-build.tar.gz` and its SHA-256 retain the successful production build,
  package manifest, lockfile and dependency policy at source revision
  `922e062b692e63b792ff48d53809b1b72fe4bb66`. Linux dependencies are installed
  by the recipe rather than copying host dependencies. Host AGY reports 1.2.0
  and is Mach-O arm64; a vendor Linux binary and its provenance remain to be
  supplied to the checksum-checked recipe.
- `scenarios.json`, `inputs/` and `input-manifest.json` retain all three
  canonical scenarios and 51 hashed input/source files. The production fixture
  loader and instruction-source validation pass.
- `execution-plan.json` retains current 3.7 Flash and historical 3.6 Flash /
  3.1 Pro, three repeats per scenario, KOTA max and expected Gemini high.
  Actual model/effort, provider availability, quota, traces, changed paths,
  rubric verdicts, pass@3 and pass^3 remain unobserved.

The selected four deterministic eval-owner suites report 15 passes and one
process-boundary failure. A diagnostic through the same production availability
owner identifies `spawnSync /bin/ps EPERM`; no process supervision was bypassed.
The passing scenario/rubric/CLI checks and build validate the prepared inputs,
not live model quality. No production code or shared routing was changed.

Routing remains **needs more data** with zero completed scenario repeats.
Resume through the existing host lifecycle with a scope-authorized contained
profile, then finish image, restricted proxy and adapter-auth verification and
run the comparison. Preserve unavailable historical rows using actual catalog
evidence; evaluate available candidates with equal resources/repeats.
No particular capture path or manual benchmark execution is required.

The first critic could not access the runtime-local packet and its independent
inspect returned `Native writer authorization denied or unavailable`. That
separate denial does not establish the host-profile blocker. Repair exposes the
existing response, preparation, payload and validation logs within the review
workspace: 71 copied files were verified byte-for-byte against the retained
originals. The response SHA-256 is
`55e761b622967781b37ed3cf7cdef80953e6717be18eab3bcfbf79a34648e174`.
This is an accessibility repair, not a new capability observation or benchmark
execution. The [review guide](../../.kota/runs/2026-09-12T14-17-30-067Z-builder-xqizqf/evidence/REVIEW.md)
links the substantive evidence and explains the remaining limits.

## Next execution

The missing host grant was an unfinished setup dependency, not a request for
owner-captured evidence. `task-complete-contained-evaluation-host-setup` now owns
the deployable image/profile journey and AGY authentication gap. This task stays
open behind that dependency. Once the setup is installed, use the retained cohort
and current native action for actual discovery and measurement. Do not repeat a
task-only blocked commit while implementation or setup can still advance. A
verified unavailable account credential, entitlement or quota is distinct from
an unperformed observation. Runtime artifacts must remain inspectable without
committing copied code, binaries or whole evidence packets into the repository.

## Blocked on

kind: operator-capture
path: .kota/runs
description: Provide an authorized matching Linux AGY setup/probe environment, or equivalent vendor documentation/source, establishing the subscription login-file location, refresh behavior and native-tool credential exclusion; this enables safe adapter implementation without inventing credential formats or exposing tokens.

The outstanding external input is the vendor authentication/isolation contract,
not evidence that an account lacks credentials. The existing contained host grant
is absent (receipt below), so this builder cannot run the matching Linux setup
probe. The official installation page was also unreachable through the configured
scoped proxy (`curl` exited 7); no direct network workaround was attempted.
An equivalent vendor contract can advance implementation without waiting for
host activation. No specific capture path or manual benchmark execution is required.

### Authentication investigation and safe changes

The installed vendor binary's bundled 1.1.3 changelog says the CLI bypasses the
keyring when no D-Bus session is present on headless Linux/containers. Its shipped
file-storage diagnostic and `NewCLITokenStorage` symbol corroborate a file route.
This disproves the previous keyring-only setup assumption, but a macOS binary
inspection does not establish the selected Linux release's storage or security
contract. The bounded excerpt and binary hash are retained in this run's
`agent/agy-model-routing/auth-contract-research/vendor-observation.json`.
The relevant vendor release-note text is quoted here for review:

> Fixed repeated sign-in prompts on Linux caused by the OS keyring: the CLI now bypasses the keyring when no D-Bus session bus is present (headless hosts and containers), skips it for an hour after a timeout, and uses longer keyring timeouts so a slow-but-successful credential read is no longer cut short and forced into a fresh login.

Installed executable SHA-256: `f3671863b53ecef2c45a41673677fe603fbe5d73df33d744feec3e88d5af0199`.
This is static vendor-source evidence, not an executed Linux login result.

The shared `AgentHarness.resolveIsolatedContainerAuth` contract requires the
adapter to deny both source and runtime credentials to native tools.
`snapshotContainerAuth` provides a read-only copy, which protects integrity but
not confidentiality. AGY cannot route native file/terminal tools through KOTA's
`canUseTool`; the maintained launcher and its tests deliberately omit AGY's
optional `--sandbox` flag. Neither that flag's help text nor a file-storage
symbol establishes exclusion of credentials from all native tools. Guessing a
plaintext login mount would violate the existing harness contract.

Corrected the adapter's error and its scoped/deployment guidance to identify
this unresolved file-storage/credential-exclusion contract. Removed stale claims
that the maintained adapter enables a nested AGY terminal sandbox. No login
projection, token format, keyring service or wider access grant was invented.
Source work now needs the concrete vendor contract above to choose a safe
projection; positive login and negative file/terminal credential probes then
validate it in the authorized Linux environment. The current unconditional
rejection remains an implementation gap, not a completed authentication feature.

## Current assessment (2026-09-12, builder mtxsm3)

Routing: **needs more data**. Zero of 27 planned scenario runs executed across
current 3.7 Flash and historical 3.6 Flash / 3.1 Pro. Actual model/effort, quota,
traces, changed paths, rubric verdicts, `pass@3` and `pass^3` remain unobserved.
No production routing changed.

### Current host receipt available for review

The following is the exact 565-byte response retained from this run's resumed
`pnpm kota eval contained '{"operation":"inspect"}'` (exit 1). It was collected
after the setup dependency was complete, with the writer at revision
`538a5487fca0f0fb124179c269d27aa684128727`. This narrow verbatim receipt is
included here because the critic cannot access the runtime packet; no evidence
packet, source tree or binary payload is added to the repository.

```json
{"tool_use_id":"tool-25dca4b145d6fad8c55a2a6e9b463aff","content":"Tool error: Set KOTA_EVAL_CONTAINED_PROFILES in the trusted host environment. Profiles declare scopeRoots, timeoutMs, cpuCores, memoryMB and a container isolationBackend with image. Deterministic probes declare probes with command and sourcePaths and use offline networking; model profiles declare preset, fixtureIds/candidates, maxRepeats and restricted provider-egress. See src/modules/eval-harness/contained-evaluation.md for setup; worker requests cannot configure host access.","is_error":true}
```

SHA-256 of the original JSON bytes (no trailing newline; exclude the Markdown
fence separator newline):
`c78e42d8340c7e4335edd63230040a7112c46f7c086f552a795b90feb4cd1cda`.
Runtime origin: this run's
`native-authorizations/123f4b43a70825d03cc355ef4be071c1/responses/tool-25dca4b145d6fad8c55a2a6e9b463aff`.
The byte-identical retained copy is `agent/agy-model-routing/resumed-contained-inspect-response.json`.
The critic's separate `Native writer authorization denied or unavailable`
response does not establish a missing host grant; the receipt above is the
observation supporting this disposition. Exposing it does not constitute a new
host observation or another benchmark attempt.

The remaining preparation stays in runtime-owned `agent/agy-model-routing/` for
run `2026-09-12T19-11-34-165Z-builder-mtxsm3`: scenario specifications, validated
request, execution plan, 58 source hashes, adapter-auth resolver observations
and routing assessment. The production fixture/instruction-source validators
accepted all three scenarios. Thirteen existing scenario/rubric, model-readiness
and container-availability tests passed; final task validation passed. These
checks establish preparation behavior, not live quality, containment or account
availability. Image, restricted Google egress and isolated login remain unverified.

Repair validation: `pnpm check:fast` passed. All 13 selected runtime-home,
adapter-execution and container-auth owner tests passed, covering existing login
projection, model/effort propagation, native launch and snapshot exclusion from
the candidate workspace. Two direct production auth-resolver probes rejected
empty and synthetic API-key environments with the corrected implementation
diagnostic. These establish the safety of the retained correction; no Linux
login, credential-confidentiality or benchmark pass is claimed.
