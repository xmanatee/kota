---
status: blocked
priority: p2
---
# Add cross-preset runtime parity gate

## Outcome

Make the shipped preset-parity journey usable through the disposable daemon,
with observable preset/model selection across boot, single/tool agent turns,
capture/recall/answer, a balanced workflow and the shipped builder AgentDef.
The builder probe is read-only; publication, runtime cleanup, Explorer
finalization and claim recovery remain with their existing owners.

Owner intent from May 7:

> мне нужно быть уверенным, что оно все реально будет работать на
> кодексе. И вот, удостоверяйся, что реально все элементы, все
> компоненты, они агностики по отношению к харнесу или модели

## Remaining Work

The composed runner and observer already exist in
`src/preset-parity-fixture.integration.ts`,
`src/preset-parity.live.test.ts` and the eval-harness preset-parity owners.
Do not recreate the original smoke test or repeat completed abstraction work.

The September 13 no-inference command
`pnpm test:integration src/preset-parity.integration.test.ts` passed seven
cases but failed the built-CLI journey with
`Missing workflow preset-parity-single-turn`. This attempt got past the old
loopback denial. Refresh the normal build first, then resolve any remaining
fixture/module-registration or discovery failure at its owner. The audit did
not rebuild `dist`, so source/build drift is not yet excluded.

## Acceptance

- The current-source disposable CLI boots with all probe workflows registered;
  its no-inference integration case passes. Keep production compilation,
  provider construction and harness-entry regressions, which passed locally.
- The eight passing model-sweep owner cases remain effective against foreign
  models, wrong tiers, missing selections and sticky-preset drift. Validate
  resolved behavior, not literal-model source greps or old filenames.
- Run live surfaces for credentials actually available through supported
  owners. Missing authentication is an explicit unexecuted row; provider,
  composition and policy errors remain visible failures. Native rejection of
  `canUseTool` is not a successful callback.
- Under the September 13 authorization, gate implementation can complete on
  available deterministic composition proof plus an honest qualification
  report. Do not require all three presets to be authenticated simultaneously,
  a contrived missing-key live rerun, or a successful model response to publish
  an otherwise verified gate. Do not claim all-preset live parity from this.

## External Qualification

Retained probes found missing Claude/Gemini API auth. Codex native login and
the separate OpenAI API credential for capture/answer are different
prerequisites; current host availability was not rechecked. No live inference
ran in this audit. Those limits do not block the reproduced no-inference issue.
Use the existing runner and ordinary permission boundary, without Docker,
parent-daemon control or a new execution service.

## Retained implementation and evidence

Run `2026-09-12T23-34-31-972Z-builder-xshnf5` refreshed the normal production
build successfully. The disposable CLI loaded `preset-parity-probe` and passed
startup definition validation before its listener failed with
`listen EPERM: operation not permitted 127.0.0.1` in this builder sandbox.
This establishes neither absent host loopback capability nor successful CLI boot.

The fixture now waits for the runtime's `definitionsLoadedAt` observation before
checking probe registration. The control listener precedes workflow activation,
so `running: true` alone could produce the earlier missing-workflow error.
The existing three preset compilation cases now use the real workflow runtime
to cover that activation gap and reject a genuinely missing loaded probe.
Required runtime/login-probe errors also take precedence over missing API auth
in the live runner, preventing a false skipped row.

`pnpm check:fast` passed. All seven selected integration cases passed, retaining
provider construction and harness-entry coverage; all ten current model-sweep
owner cases passed. The complete no-inference file still has one failed CLI
case at the listener boundary. Live qualification retained two missing-auth
skips (Claude/Gemini) and one visible Codex login-probe error; no inference ran.
The OpenAI API key was not exposed to this agent environment, and sandbox denial
prevents a conclusion about host native login availability.

## Blocked on

kind: operator-capture
path: .kota/runs/
description: Attributable current-source disposable CLI boot evidence from an authorized execution boundary permitting its loopback listener.

The explicitly required disposable built-CLI boot acceptance needs an
attributable execution through a permitted loopback boundary. The current
builder sandbox rejects that listener; no exposed scoped execution alternative
was available. Resume this same retained run with the ordinary no-inference
command once that execution prerequisite is available, inspect registration and
cleanup, and address any subsequent visible failure. This does not require all
presets to authenticate, successful live inference, parent-daemon control,
publication, or deployment observation.

The retained changes are independently verified by the static gate and scoped
runtime cases. Detailed qualification, command logs and preflight projections
remain in this run's `agent/` artifacts, including `qualification.md`.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-13T00:32:05.276Z -->
