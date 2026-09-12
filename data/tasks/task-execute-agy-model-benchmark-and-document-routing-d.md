---
status: open
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
