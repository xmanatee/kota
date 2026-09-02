---
status: done
---

# Migrate and diagnose historical workflow metadata

## Problem

Commit `0dad16db9` stopped malformed children of `.kota/runs` from crashing enumeration by adding `readWorkflowRunMetadataForEnumeration`, but that helper catches every error and returns `null`. Historical schema forms can therefore disappear silently, known token and cost facts are not normalized, and fixtures or synthetic evidence can still occupy the live run namespace.

## Scope / Starting Points

- `src/core/workflow/run-metadata.ts`
- `src/core/workflow/run-store.ts` and `run-store-retention.ts`
- `src/modules/workflow-ops/runs/workflow-history.ts`
- health, progress, pruning, and autonomy-projection consumers of stored runs
- non-run artifacts currently stored below `.kota/runs`

Historical cases include old `schemaRef` forms, top-level token or cost fields, legacy terminal statuses, agent steps without usage envelopes, malformed terminal records, and malformed active or recovery-critical records.

## Required Changes

- Introduce an explicit metadata version and one normalizer returning typed `valid`, `migrated`, `quarantined`, or `invalid-authority` outcomes.
- Preserve known status, workflow, trigger, step, usage, cost, and provenance facts during normalization; never silently zero known values.
- Keep direct lookup of active, waiting, integrating, and recovery-critical runs strict and fail closed with an actionable diagnostic.
- Make enumeration, retention, history, health, progress, and projections consume the same result owner and surface bounded warnings for quarantined terminal history.
- Move fixtures and synthetic evidence to an owned namespace outside the live run store and stop treating arbitrary child directories as runs.
- Keep current writes singular; remove transition-only readers after the supported corpus has been migrated.

## Must Not Complete While

- Any historical format named above is silently discarded.
- Any active or recovery-critical record can be ignored or treated as terminal evidence.
- Any consumer implements its own tolerance rules.
- Non-run fixture directories remain part of production run enumeration.

## Done When

- Every named historical case has an explicit expected outcome and recoverable facts survive normalization.
- One malformed terminal record yields an observable quarantine diagnostic without blocking daemon startup.
- One malformed authority-critical record stops the affected operation with a precise recovery action.
- All enumerating consumers use the canonical result owner and no broad `catch { return null }` path remains.
- Fresh writes and normalized historical reads expose one current representation.

## Acceptance Evidence

Provide the historical-case matrix, before/after metadata examples, affected consumer list, and daemon startup/dispatch observations for terminal quarantine and active failure-closed paths.

## Source / Intent

Narrowed after `0dad16db9`: schema v4 is complete; silent enumeration and historical metadata ownership remain.

## Initiative

Lean behavioral verification requires one durable metadata contract rather than compatibility behavior copied into every workflow consumer.
