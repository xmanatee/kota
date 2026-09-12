---
status: open
priority: p1
---
# Run live OpenRouter and local model rollout evaluation

## Outcome

Produce useful, honestly bounded KOTA model comparisons and a routing decision,
starting with available routes instead of requiring every provider to be ready.
The owner wants practical alternatives to Codex/Claude, not a favorable
leaderboard or a predetermined replacement verdict. No default changes follow
from readiness, synthetic runs or missing measurements.

## Actionable Implementation

The existing contained matrix, native/local routing, raw/scaffold adapters and
integer admission repair have integrated. However,
`prepareContainedMatrix` in
`src/modules/harness-parity/contained-matrix.ts` eagerly resolves every native
auth locator before returning any executions. A September 13 source-level
probe with a synthetic unavailable Codex locator and a local candidate threw
`synthetic native credential unavailable` for the entire preparation.
No credentials, model or container were used. Thus an unavailable baseline can
still prevent independently useful local work.

Support bounded partial cohorts through the existing preparation/report owners.
Keep explicitly unavailable credential/capability rows attributable, while
preparing independently authorized compatible rows. Do not silently omit the
baseline, substitute API auth for native login, or turn invalid grants,
malformed profiles, isolation failures or unexpected errors into successful
skips. Reuse existing row/result types where suitable; no new benchmark runner
or host execution bridge. This shared repair belongs here, not in the coding
parity task too.

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

September 13 contained-matrix owner tests passed (nine cases), but the new
partial-readiness case above is not handled. Retained September 12 host
inspection reported unset `KOTA_EVAL_CONTAINED_PROFILES`; local Qwen inference
readiness in the setup record is not an empty inventory or a live matrix pass.
Current credentials, image and egress were not rechecked.

The owner has authorized Docker validation, but the current coordinator's
execution guard denied container runs. This is an observed environment limit,
not a permanent project prohibition. Use the normal authorized execution path
when available; do not bypass an execution denial through another interface.
Missing authorized container capability remains an external prerequisite for
live rows, not for the repair above. Once implementation is verified, keep
only genuinely unavailable live qualification explicit in this task; do not
create another setup task, evidence packet or recurring readiness-only loop.
Runtime cleanup, Explorer finalization and held-claim recovery are out of scope.
