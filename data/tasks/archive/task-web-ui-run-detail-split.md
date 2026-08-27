---
status: done
---

# Split client-run-detail.ts into focused sub-modules

## Problem

`src/web-ui/client-run-detail.ts` has grown to 826 lines while the project cap is
~300 lines. It mixes run metadata rendering, step progress display, approval-step
inline state, abort/retry controls, causedBy link rendering, and hash-based
permalink navigation into a single file. Every addition or fix touches the same
large surface, increases merge-collision risk, and makes the code harder to read
in isolation.

Five separate feature tasks landed in this file on the same day (run detail
permalink, abort button, retry button, triggered-runs list, approval step inline),
confirming it is the central point of churn in the web UI.

## Desired Outcome

`client-run-detail.ts` is split into two or three sub-modules with clear
responsibilities, each under ~300 lines:

- `client-run-detail-controls.ts` — abort/retry button rendering and click handlers
- `client-run-detail-steps.ts` — step list, progress rendering, and approval-step inline indicator
- The remaining metadata, causedBy links, and permalink logic stays in a trimmed
  `client-run-detail.ts` or is renamed to `client-run-detail-meta.ts`

The public API (`showRunDetail`, `closeRunDetail`, `scrollToApprovals`) must remain
importable from the existing path or a stable re-export in `client.ts` so the
assembler is not broken.

## Constraints

- No behavior changes; this is a pure structural refactor.
- `client.ts` assembly must continue to compose correctly.
- All existing web-UI tests must continue to pass.
- Each resulting file must be under 300 lines.

## Done When

- No single file in `src/web-ui/` exceeds 300 lines.
- `web-ui.test.ts` passes without modification to test logic.
- `client.ts` imports and assembles the split modules cleanly.
- `src/web-ui/AGENTS.md` is updated to reflect the new file layout.
