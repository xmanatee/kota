---
status: open
priority: p2
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
