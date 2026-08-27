---
status: done
---

# Add Codex auth-expiry adapter observability evidence

## Problem

    Builder run 2026-07-08T06-23-36-951Z-builder-6ddjzf completed the native CLI auth-expiry task, but its observability-obligation review still marks src/modules/codex-agent-harness/adapter.ts as missing inspectable evidence for the runtime-sensitive adapter change.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-08T06-59-45-384Z-progress-reviewer-aihj18.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-08T06-59-45-384Z-progress-reviewer-aihj18.

review verdict: needs-steering
review summary:

    The window shows useful progress: Safety 5, Product 4, Platform 4, Meta 7, with new actionable Safety and Platform tasks created. Steering is still needed because three builder dead letters and two owner/setup questions remain open, and the auth-expiry builder run left one unresolved observability warning.

Evidence ids:

- run:2026-07-08T06-23-36-951Z-builder-6ddjzf
- artifact:2026-07-08T06-23-36-951Z-builder-6ddjzf:run-summary.json
- git:commit:b02b6d72e8b3
- task:task-warn-before-native-cli-harness-auth-expires-during

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A follow-up run artifact or focused test maps src/modules/codex-agent-harness/adapter.ts to inspectable observability evidence or a narrow waiver rationale, the observability-obligation diagnostic no longer reports that file as unresolved for this change, and focused adapter/readiness tests plus validate-tasks pass.

- Follow-up evidence from builder run 2026-07-08T07-22-16-062Z-builder-yzdgdv:

    `src/modules/codex-agent-harness/adapter.test.ts` now asserts the Codex adapter's own `readiness()` output for expiring and stale ChatGPT auth status metadata, including renewal guidance and redacted auth detail. `src/modules/autonomy/observability-obligation.test.ts` models the cited `git:commit:b02b6d72e8b3` adapter auth-expiry diff alongside that related adapter test and asserts the diagnostic returns `outcome: "ok"`, keeps `src/modules/codex-agent-harness/adapter.ts` out of `missingFiles`, and records `focused-test-assertion` evidence pointing at `src/modules/codex-agent-harness/adapter.test.ts`. Run artifact `.kota/runs/2026-07-08T07-22-16-062Z-builder-yzdgdv/observability-follow-up-evidence.json` records the mapping. Focused validation passed with `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner --silent=true src/modules/codex-agent-harness/adapter.test.ts src/core/agent-harness/readiness.test.ts src/modules/autonomy/observability-obligation.test.ts` (3 files, 22 tests), `pnpm exec biome check src/modules/codex-agent-harness/adapter.test.ts src/modules/autonomy/observability-obligation.test.ts`, and `pnpm run validate-tasks`.
