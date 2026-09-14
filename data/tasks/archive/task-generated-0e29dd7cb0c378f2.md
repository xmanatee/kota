---
status: done
---
# Reject silently truncated evaluation CLI numeric options

## Problem

Both evaluation CLIs use duplicated parseInt-based validation: --repeats 1.5 dispatches 1, --repeats 3oops dispatches 3, and --repeats 1e3 dispatches 1. Eval --memory-allocation-mb 1e3 dispatches 1 MB; matrix --max-turns 2.9 dispatches 2. Eval's positive-number parser also accepts --cpu-allocation 2oops as 2. Numeric runtime validators see already-normalized values and cannot reject the malformed original requests.

Investigation: Assessed a4b16f6da523b6c10d4e6d94 and 4ed1d3c39057b7415f61115f. Production Commander probes confirmed that eval and matrix integer parsers silently truncate fractions, trailing junk and exponent notation before dispatch. Downstream integer validation cannot recover the original input. This warrants a narrow shared decoding repair. Active model-qualification tasks do not cover this CLI defect. The channel prefix helpers serve maintained consumers and produced matching probe outcomes; consolidation is feasible but no consequential simplification or divergence was established, so that observation needs no action. Delivery correlation is unproven; the worktree dead-letter file was unavailable. No tracked files changed, live execution occurred, or comprehensive preservation was verified.

Evidence:
- a4b16f6da523b6c10d4e6d94
- 4ed1d3c39057b7415f61115f
- docs/STANDARDS.md
- docs/VERIFICATION.md
- docs/ARCHITECTURE.md
- src/modules/eval-harness/AGENTS.md
- src/modules/eval-harness/index.ts
- src/modules/eval-harness/cli-command.ts
- src/modules/eval-harness/cli.ts
- src/modules/eval-harness/cli-run-options.test.ts
- src/modules/eval-harness/eval-set.ts
- src/modules/harness-parity/AGENTS.md
- src/modules/harness-parity/index.ts
- src/modules/harness-parity/cli.ts
- src/modules/harness-parity/matrix-cli.ts
- src/modules/harness-parity/model-matrix.ts
- src/core/modules/bundled-module-discovery.ts
- src/core/modules/runtime-module-discovery.ts
- src/modules/slack-channel/AGENTS.md
- src/modules/slack-channel/inbound-signal.ts
- src/modules/slack-channel/inbound-signal.test.ts
- src/modules/slack-channel/bot-inbound-signal.ts
- src/modules/telegram/AGENTS.md
- src/modules/telegram/inbound-signal.ts
- src/modules/telegram/inbound-signal.test.ts
- src/modules/telegram/bot-message-runtime.ts
- src/modules/inbound-signals/AGENTS.md
- src/modules/inbound-signals/events.ts
- data/tasks/task-run-live-openrouter-and-local-model-rollout-evalua.md
- data/tasks/task-capture-an-end-to-end-coding-task-parity-artifact-.md
- data/tasks/task-execute-agy-model-benchmark-and-document-routing-d.md
- data/tasks/archive/task-extend-harness-parity-and-eval-harness-with-model-.md
- data/tasks/archive/task-route-slack-and-telegram-updates-through-the-inbou.md
- data/tasks/archive/task-expand-telegram-signals-beyond-text-messages.md
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t14-07-51-236z-archite-79774a066148eea6e60a32d6aad14d364a688402e43e482d1693db9b3be02da5/agent/investigation.md
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t14-07-51-236z-archite-79774a066148eea6e60a32d6aad14d364a688402e43e482d1693db9b3be02da5/agent/cli-numeric-probe.mjs
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t14-07-51-236z-archite-79774a066148eea6e60a32d6aad14d364a688402e43e482d1693db9b3be02da5/agent/cli-numeric-probe.json
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t14-07-51-236z-archite-79774a066148eea6e60a32d6aad14d364a688402e43e482d1693db9b3be02da5/agent/channel-prefix-probe.json

## Desired Outcome

Evaluation commands validate the complete numeric argument before dispatch, preserve accepted values exactly, and reject unsupported syntax and invalid domains with option-specific errors. One narrow owner defines common decoding semantics. Reduced maintenance burden is expected, not measured.

This is an unverified expectation, not a measured improvement.

Maintained consumers:
- Eval CLI integer options for repeats, memory limits, calibration sample counts and fixture-candidate limits
- Eval CLI positive-number resource options
- Harness-parity matrix repeats, maximum turns and optional positive resource values

Alternatives considered:
- Leave the implementations unchanged: retains demonstrated silent changes to operator input.
- Repair each parser independently: fixes behavior but retains duplicated decoding rules.
- Share narrow decoding under eval-harness through harness-parity's existing dependency: preferred.
- Introduce a general core CLI framework: unsupported by the bounded common behavior.

Migration and retirement: Migrate the existing numeric-helper callers in eval cli.ts and parity matrix-cli.ts to narrow eval-owned decoding, retaining option labels, defaults and integer-versus-real distinctions. Remove replaced permissive helpers. Preserve runtime numeric validation for direct API consumers. Link provenance to task-extend-harness-parity-and-eval-harness-with-model-; keep blocked live qualification contracts intact.

Common behavior: Decode a complete CLI numeric argument and reject invalid values before client dispatch.
Stable variation point: Positive integer versus positive real domain, optional absence, and the option name used in diagnostics.
Canonical owner: A narrow helper within eval-harness, consumed by harness-parity through its existing declared eval-harness dependency.

## Constraints

Preserve the maintained consumers' domain-specific behavior.

## How We Will Know

Exercise production Commander commands through recording client ports. Verify malformed suffixes, fractional integer inputs, zero, negative and nonfinite values reject before dispatch; valid integers and fractional CPU allocations propagate exactly; defaults and absent optional fields retain their meaning. Define exponent-notation handling explicitly: accept its exact value or reject it, never truncate it. Run affected deterministic checks; no live model execution is needed.

Show both maintained command paths use the same decoding owner, replaced helpers are removed, and callers retain only domain-specific options and request construction. Preserve distinct runtime validation and command propagation proofs without duplicating parser case matrices.

Record actual migrated callers, retired paths and the simpler result in this task's completion evidence. The gardener follows this task; expected benefits alone do not establish success.


## Completion evidence

Implemented one eval-owned decoder in
`src/modules/eval-harness/cli-numeric-options.ts`. Complete decimal arguments
are checked before conversion can conceal unsupported syntax. Exponents, radix
prefixes, whitespace, junk suffixes and nonfinite values reject. Integer options
require positive safe integers and reject fractional syntax; positive real
options retain fractional values. Calibration rates retain the inclusive 0–1
domain. Errors identify the option, expected domain and original input.

Migrated callers:
- Eval run: repeats, CPU allocation/kill threshold and both memory options.
- Eval calibration: minimum samples, both day windows and threshold rate; the
  adjacent float parsers had the same truncation defect.
- Eval fixture-candidates: scan limit.
- Parity matrix: repeats, maximum turns and four optional resource options.
- Parity run: maximum turns, whose inline parser had the same defect.

Retired both duplicated integer helpers, eval's permissive positive-real helper,
matrix's optional-number helper, the inline parity-run integer parser and the
three calibration parseFloat calls. Command owners retain option declarations,
absence/default handling and request construction. Harness-parity consumes the
shared decoder through its existing declared eval-harness dependency. Direct API
runtime numeric validators remain in place.

Command probes additionally exposed matrix's mismatched Commander field names:
`memoryAllocationMB`/`memoryKillThresholdMB` silently dropped both supplied memory
options. Reading Commander's `memoryAllocationMb`/`memoryKillThresholdMb` now
validates and forwards their values. The request's public MB field names remain
unchanged, and matrix's existing positive-real resource domain is preserved.

Validation:
- `pnpm test:owner src/modules/eval-harness/cli-run-options.test.ts
  src/modules/eval-harness/cli-calibration.test.ts
  src/modules/eval-harness/cli-fixture-candidates.test.ts
  src/modules/eval-harness/eval-set-profile-validation.test.ts
  src/modules/harness-parity/cli.test.ts
  src/modules/harness-parity/model-matrix.test.ts`: 65 tests passed across six
  files. One eval command case matrix owns common rejection semantics; the other
  command cases detect missed option wiring, lost defaults/absence, and changed
  domains. Existing runtime profile and matrix tests retain direct-API and
  execution-propagation proof.
- `pnpm check:fast`: passed production/test typechecks, lint, task validation,
  generated client/UI binding checks and admission of 90 bundled modules.
- Eleven standalone production Commander probes through recording client ports
  passed. Run artifact `cli-numeric-probe.json` retains argv, dispatched requests,
  errors, rendered success output and source hashes; `agent/cli-numeric-probe.mjs`
  is the reproducer in builder run `2026-09-14T14-15-37-417Z-builder-hw4kht`.
  These establish the CLI boundary, not live inference. No models were executed.

This repairs the CLI boundary of the model-evaluation surfaces introduced in
[the model-matrix extension](task-extend-harness-parity-and-eval-harness-with-model-.md).
Blocked live qualification contracts were not edited. Shared ownership and removed
parsers are observable simplifications; reduced future maintenance cost is an
expectation, not a measured benefit.
