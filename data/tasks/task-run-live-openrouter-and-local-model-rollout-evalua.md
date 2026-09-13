---
status: blocked
priority: p1
---
# Run live OpenRouter and local model rollout evaluation

## Outcome

Produce useful, honestly bounded KOTA model comparisons and a routing decision,
starting with available routes instead of requiring every provider to be ready.
The owner wants practical alternatives to Codex/Claude, not a favorable
leaderboard or a predetermined replacement verdict. No default changes follow
from readiness, synthetic runs or missing measurements.

## Preparation Repair And Live Qualification

The existing contained matrix, native/local routing, raw/scaffold adapters and
integer admission repair have integrated. Before this repair,
`prepareContainedMatrix` in
`src/modules/harness-parity/contained-matrix.ts` eagerly resolved every native
auth locator before returning any executions. A September 13 source-level
probe with a synthetic unavailable Codex locator and a local candidate threw
`synthetic native credential unavailable` for the entire preparation.
No credentials, model or container were used. An unavailable baseline prevented
independently useful local work.

The retained change supports bounded partial cohorts through the existing preparation/report owners.
Keep explicitly unavailable credential/capability rows attributable, while
preparing independently authorized compatible rows. Do not silently omit the
baseline, substitute API auth for native login, or turn invalid grants,
malformed profiles, isolation failures or unexpected errors into successful
skips. Reuse existing row/result types where suitable; no new benchmark runner
or host execution bridge. The public matrix preflight follow-up is now complete
in [task-complete-partial-matrix-preflight-at-public-boundaries](archive/task-complete-partial-matrix-preflight-at-public-boundaries.md).
Its retained completion evidence covers partial cohorts and strict typed failures;
the four real-launch checks exposed a separately reproduced `spawnSync /bin/ps EPERM`
sandbox restriction. This is preparation and diagnosis evidence, not live model
or container qualification. Continue the live outcome here without duplicating
the completed repair or the coding parity task.

## Acceptance

- A focused owner regression reproduces the unavailable-native/available-local
  case and verifies explicit unexecuted baseline evidence plus retained local
  preparation. Existing strict grant, isolation and malformed-input rejection
  remain intact. Available process-port tests can validate report composition;
  they are not live containment or quality proof.
- Retain the requested Codex/GPT-5.5 baseline and GLM-5.2, Kimi K2.7 Code,
  DeepSeek V4 Pro/Flash, Qwen 3.7 Plus, MiniMax M3, MiMo V2.5 and local-model
  rows. Refresh actual catalog availability; unavailable historical models
  remain named, not silently substituted.
- Begin live collection with one useful authorized cohort; a one-repeat smoke
  may find setup defects. Expand only for a concrete comparison decision.
  A full simultaneous matrix and three repeats of every unavailable route
  are not prerequisites for useful implementation or partial results.
- Reports retain actual prompt/model/harness, verifier, trace/diff, usage,
  latency and available cost/activity diagnostics. Unknown metrics stay
  unavailable. Missing baseline, unequal resources/repeats or inadequate
  samples are non-gating, not evidence for a support tier.
- Promotion still requires comparable sufficient equal repeats, at least 90%
  of native Codex baseline `pass^k` and no P0 parity failures. Narrow support
  needs measured task-class evidence. Otherwise report needs-more-data or a
  bounded negative result; no replacement claim or production preset change.

## Qualification And Ownership

September 13 contained-matrix owner tests passed (nine cases) before this repair.
Retained September 12 host
inspection reported unset `KOTA_EVAL_CONTAINED_PROFILES`; local Qwen inference
readiness in the setup record is not an empty inventory or a live matrix pass.
Current credentials, image and egress were not rechecked.

The owner has authorized Docker validation, but the previously observed
coordinator execution guard denied container runs. This is an observed environment limit,
not a permanent project prohibition. Use the normal authorized execution path
when available; do not bypass an execution denial through another interface.
Missing authorized container capability remains an external prerequisite for
live rows, not for the repair above. Once implementation is verified, keep
only genuinely unavailable live qualification explicit in this task; do not
create another setup task, evidence packet or recurring readiness-only loop.
Runtime cleanup, Explorer finalization and held-claim recovery are out of scope.

## Blocked on

kind: operator-capture
path: .kota/runs/
description: A trusted host grant and authorized contained execution for at least one useful model cohort, or equivalent attributable live comparison evidence.

Live qualification requires a trusted host contained-evaluation profile for at
least one useful cohort in this scope. This run called the authorized native
invocation surface, `pnpm kota eval contained '{"operation":"inspect"}'`;
the host returned `Set KOTA_EVAL_CONTAINED_PROFILES in the trusted host environment`
(tool use `tool-bb11361757bcc9a5f44690f41bacff97`). This establishes a missing
host grant, not missing provider credentials, an empty local inventory, or a
permanent Docker prohibition. The worker cannot author that grant or restart
its parent. Existing deployment/setup owners supply the profile; no new setup
task or host execution bridge is needed.

Operator recheck at `2026-09-13T00:01Z`: Docker reports server version 29.3.1,
but a minimal read-only, unprivileged, network-disabled container invocation
was rejected by the execution hook with `Structural guard: destructive docker
commands are blocked`. No container ran. The owner's Docker approval remains
recorded, but it does not remove this current execution restriction. Do not
bypass it through a different API, command spelling or workflow.

The public OpenRouter catalog refresh was also attempted through the supplied
network path; curl could not connect to the invocation's proxy. The shipped
catalog remains dated 2026-06-26, and current availability is unverified. Keep
all requested historical names and the local-model row. No substitutions,
support tier, replacement claim, or production preset change are justified.
The routing decision remains **needs-more-data**.

Resume live collection through the existing contained matrix with one repeat
once an authorized cohort is available, retaining explicit unavailable baseline
rows. Positive inference and negative confinement evidence, actual catalog
availability, and measured comparison diagnostics remain unmet. The preparation
repair is independent of those external prerequisites.

## Repair Verification

Run `2026-09-12T23-34-29-865Z-builder-8dcny0` retained the repair in the existing
harness-parity preparation/report owners, a typed adapter unavailability error,
and strict login-file validation in eval-harness. All 13 contained-matrix cases
passed across targeted executions, including the unavailable-native/local pair,
normal equal repeats, grant rejection, malformed locators, missing images,
verifier relocation, and cancellation. Container-auth owner checks passed.
`pnpm check:fast` passed before the task disposition edit; final task validation
is recorded with the run summary.

Process-port tests establish preparation, report composition and failure
handling, not live quality or containment. Earlier interrupted tests lost their
invocation temporary directory. Using the durable run directory instead caused
an OS `getcwd` denial in Git; those report cases passed after returning to the
normal invocation temporary directory. Four unmocked subprocess cases remain
failed in the broader routing checks (three missing launch logs, one error-row
result); they are not claimed as passes. Details and logs are in this run's
`agent/summary.md`. No production routing or isolation policy was relaxed.
These synthetic subprocess failures did not establish a live credential or
Docker prerequisite. The completed public-preflight follow-up linked above
subsequently identified and independently reproduced the process-inspection
restriction; its completion record supersedes this earlier unresolved diagnosis.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-13T00:32:05.276Z -->
