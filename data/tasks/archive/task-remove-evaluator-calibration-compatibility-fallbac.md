---
status: done
---

# Remove evaluator calibration compatibility fallback

## Problem

`writeCalibrationArtifact` accepts an optional `criticVerdictRunDir` and falls
back to the canonical workflow run root for "older and direct callers". The
production builder already supplies the workspace-local critic directory
explicitly. The fallback keeps two verdict lookup paths, allows a caller wiring
error to read unrelated/stale evidence, and preserves tests for a compatibility
contract the project explicitly does not want.

## Desired Outcome

Every production calibration write names its validated critic verdict source.
The evaluator reads one explicit location and fails clearly when that evidence
is absent or invalid.

## Constraints

- Make the source required at the owning API boundary; do not replace the
  fallback with another inferred directory or optional alias.
- Preserve fail-safe evaluator semantics and provenance validation.
- Remove compatibility-only fixtures and comments while retaining behavioral
  coverage for missing, malformed, mismatched, and valid verdict evidence.

## Done When

- `criticVerdictRunDir` or its typed replacement is required for every caller.
- No production calibration path searches the canonical run root as fallback.
- Builder and direct-call fixtures pass an explicit source and prove stale
  evidence elsewhere cannot be consumed.
- Source search contains no evaluator-calibration compatibility branch or
  legacy fixture for this behavior.

## Source / Intent

Created from the owner-requested last-50-commit audit on 2026-08-13. The
fallback is documented at `src/modules/autonomy/evaluator-calibration.ts:236`
and the only production caller, builder workflow, already supplies the explicit
workspace verdict directory.

## Initiative

One authoritative evaluator evidence path.

## Acceptance Evidence

- Focused calibration evidence-source fixture transcript.
- Source-search output showing the fallback and compatibility fixture are gone.
