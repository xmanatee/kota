---
status: done
---

# Add observability evidence for OpenRouter preset and daemon route changes

## Problem

Builder run 2026-06-26T06-42-54-804Z-builder-o9wjhn landed the OpenRouter catalog and candidate presets, but its observability-obligation review reported missing inspectable evidence for runtime-sensitive changes in src/core/model/preset.ts and src/modules/daemon-ops/index.ts.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-26T07-18-56-314Z-progress-reviewer-pi6g8c.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-26T07-18-56-314Z-progress-reviewer-pi6g8c.

review verdict: needs-steering
review summary: Needs steering: balance is Product 2, Safety 2, Platform 10, Meta 4, Unclassified 2. Calibration, security review, fan-out consolidation, and queue promotion are healthy, but the latest OpenRouter builder run left a concrete observability-obligation warning for runtime-sensitive preset and daemon files.

Evidence ids:

- run:2026-06-26T06-42-54-804Z-builder-o9wjhn
- task:task-add-openrouter-model-capability-catalog-and-candid
- git:commit:5f56227b163c

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A follow-up run artifact or task acceptance section maps src/core/model/preset.ts and src/modules/daemon-ops/index.ts to structured logging, events, explicit error-result evidence, focused test assertions, or an explicit waiver rationale; the observability-obligation diagnostic for this change reports no unresolved missing files.

## Resolution Evidence

- `src/core/model/preset.ts` is mapped to focused test assertion evidence in `src/core/model/preset.test.ts`: the OpenRouter lab preset test now asserts the full diagnostic metadata for the preset id, harness, auth contract, default model, tier models, output token limits, and effort while keeping it non-default.
- `src/modules/daemon-ops/index.ts` is mapped to focused test assertion evidence in `src/modules/daemon-ops/index.test.ts`: the daemon start command test now asserts the operator-visible `--preset` help metadata includes `openrouter-lab`, `KOTA_PRESET`, and `config.defaultPreset`.
- `.kota/runs/2026-06-26T09-22-26-424Z-builder-tx5v9b/observability-obligation-recheck.json` records the direct detector recheck against `git:commit:5f56227b163c` for the two cited source files plus the new related test diff. The recheck result is `outcome: ok`, `satisfiedFiles: ["src/core/model/preset.ts", "src/modules/daemon-ops/index.ts"]`, and `missingFiles: []`.
- `.kota/runs/2026-06-26T09-22-26-424Z-builder-tx5v9b/observability-obligation-review.json` records the standard staged-diff diagnostic for this follow-up change. The result is `OK: no staged production runtime-observability obligation candidates`.
- Validation: `pnpm test src/core/model/preset.test.ts src/modules/daemon-ops/index.test.ts src/modules/autonomy/observability-obligation.test.ts` passed with 3 files and 52 tests.
