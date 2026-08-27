---
status: done
---

# Split src/manifest/step-language.ts — extract condition/template helpers

## Problem

`src/manifest/step-language.ts` is 307 lines (2% over the 300-line limit). The file bundles reference resolution, condition evaluation, and template rendering.

## Desired Outcome

`step-language.ts` shrinks to ≤300 lines. Extracted logic lives in a co-located helper module. No behavior changes.

## Constraints

- Public exports must remain the same or be re-exported from `step-language.ts`.
- All tests must pass after the split.

## Done When

- `manifest/step-language.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
