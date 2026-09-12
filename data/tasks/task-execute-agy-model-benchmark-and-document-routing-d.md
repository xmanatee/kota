---
status: blocked
priority: p1
---
# Execute AGY model benchmark and document routing decision evidence

## Outcome

Compare the current AGY preset model with available requested historical
candidates using the existing eval suite, then derive a routing decision from
actual task adherence, changed paths and verifier results. The August 7 owner
request preferred Gemini 3.6 Flash; it does not authorize manufacturing evidence
for that preference. The retained September 12 cohort used current 3.7 Flash
and historical 3.6 Flash / 3.1 Pro. Resolve the actual current catalog at execution.

## Current Implementation

The AGY scenario/rubric suite, availability owner and contained setup recipe
exist. The remaining auth implementation is deliberately closed:
`resolveAntigravityCliContainerAuth` in
`src/modules/antigravity-cli-agent-harness/runtime-home.ts` rejects subscription
login projection. AGY's headless Linux file-storage fallback disproves the old
keyring-only assumption, but does not establish its file location, refresh
semantics or exclusion from native file/terminal tools. A read-only token mount
protects integrity, not confidentiality.

## Blocked on

kind: operator-capture
path: .kota/runs/
description: Matching authorized Linux AGY capability, or concrete vendor contract evidence, sufficient to implement subscription login without exposing credentials to native tools.

Retained builder `2026-09-12T19-11-34-165Z-builder-mtxsm3` records the vendor
investigation and an unset `KOTA_EVAL_CONTAINED_PROFILES` host response
(`tool-25dca4b145d6fad8c55a2a6e9b463aff`). No Linux login/confidentiality probe
or benchmark completed. Current account credentials and entitlement are unknown,
not established absent. The owner authorized Docker, but container execution
was denied by the current guard. Do not bypass that denial, export a host keychain,
guess a token format, substitute paid API
auth for subscription login, or launch repeated unchanged preflights.

Concrete vendor evidence can reopen implementation before live capability is
available; another generic auth survey or copied setup packet is not required.

## Remaining Work And Acceptance

- Once the missing contract is established, implement the narrow adapter-owned
  login projection using existing auth/process owners. Validate positive login
  and denial of native-tool credential access in an authorized environment;
  retain fail-closed rejection wherever exclusion cannot be enforced.
- Execute available candidates through the existing scenario suite with actual
  model/effort attribution, traces, path-scope and rubric results. KOTA max maps
  only to effort supported by that model; intrinsic-reasoning models receive
  no invented effort flag.
- Start with a bounded useful run, then use comparable equal repeats sufficient
  for a routing decision. Missing historical candidates or quota are explicit
  unexecuted rows, not reasons to suppress other useful results. Three-repeat
  comparisons remain appropriate for a positive consistency claim, not an
  admission requirement for implementation or diagnostics.
- Record needs-more-data, rejection or a supported scoped conclusion honestly.
  No preferred-model victory, fixed artifact directory or production preset
  change is required. Runtime-returned artifacts suffice.

The retained build, scenario and adapter tests establish preparation, not model
quality. Routing remains needs-more-data with zero completed scenario repeats.
Shared partial-cohort reporting is owned by the OpenRouter/local rollout task;
do not duplicate its repair, runtime cleanup or host setup work here.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-12T23:38:46.335Z -->
