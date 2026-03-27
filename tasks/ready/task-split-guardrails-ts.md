---
id: task-split-guardrails-ts
title: Split guardrails.ts — extract risk classification into guardrails-classify.ts
status: ready
priority: p2
area: code-quality
summary: guardrails.ts is 282 lines and approaching the 300-line limit. The risk classification group (safeTools, moderateTools, DANGEROUS_*_PATTERNS, extractCommand, isDangerousCommand, isDangerousCode, isOutsideProject, classifyRisk) is cohesive and self-contained. Moving it to a new guardrails-classify.ts leaves guardrails.ts focused on policy resolution, assessment, config, and the public surface.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/guardrails.ts` is 282 lines and growing toward the 300-line file size limit. It combines two distinct concerns: risk classification (which tools and input patterns are dangerous) and policy enforcement (how to respond to a given risk level). The classification layer is self-contained.

## Desired Outcome

A new `src/guardrails-classify.ts` contains the risk classification functions and constants:
- `safeTools()`, `moderateTools()`
- `DANGEROUS_COMMAND_PATTERNS`, `DANGEROUS_CODE_PATTERNS`, `MUTATION_METHODS`
- `extractCommand`, `isDangerousCommand`, `isDangerousCode`, `isOutsideProject`, `classifyRisk`

`src/guardrails.ts` retains the policy layer: `resolvePolicy`, `assess`, `NON_INTERACTIVE_POLICIES`, `nonInteractiveConfig`, `getDefaultConfig`, `sanitizeGuardrailsConfig`, and the exported types.

## Constraints

- Exported types (`RiskLevel`, `Policy`, `GuardrailsConfig`, `Assessment`) stay in `guardrails.ts` — do not change their public import path.
- `classifyRisk` can export from `guardrails-classify.ts` and re-export from `guardrails.ts` if needed, or callers can be updated.
- All tests and imports must continue to pass without modification.

## Done When

- `src/guardrails-classify.ts` exists with the classification group.
- `src/guardrails.ts` is measurably shorter (target ≤ 160 lines).
- `npm run typecheck`, `npm run test`, and `npm run lint` all pass.
