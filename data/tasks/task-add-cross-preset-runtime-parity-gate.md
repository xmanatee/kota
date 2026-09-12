---
status: open
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
