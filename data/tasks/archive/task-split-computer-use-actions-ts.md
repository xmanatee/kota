---
status: done
---

# Split tools/computer-use-actions.ts — extract mac and linux implementations into platform files

## Problem

`tools/computer-use-actions.ts` is 285 lines and near the file size limit. The Mac-specific functions (`macClick`, `macDoubleClick`, `macType`, `macKey`, `macScroll`, `macCursorPosition`, etc.) and Linux-specific functions (`linuxClick`, `linuxDoubleClick`, `linuxType`, `linuxKey`, `linuxScroll`, `linuxCursorPosition`, etc.) are clearly separate platform implementations mixed into one file.

## Desired Outcome

Extract platform-specific implementations into co-located files:
- `computer-use-actions-mac.ts` — all `mac*` exported functions plus Mac-specific helpers (osascript, cliclick detection, key code maps)
- `computer-use-actions-linux.ts` — all `linux*` exported functions plus xdotool helpers

`computer-use-actions.ts` retains only shared utilities (`parseCombo`, `EXEC_OPTS`, `resetComputerUseState`, `needCoords`) and re-exports platform functions so existing callers are unaffected.

## Constraints

- No behavior changes — structural split only.
- All existing imports of `computer-use-actions.ts` continue to work.
- Shared parsing/key-map utilities that both platforms use must remain accessible.

## Done When

- `computer-use-actions-mac.ts` and `computer-use-actions-linux.ts` exist with their respective implementations.
- `computer-use-actions.ts` is measurably shorter (under 120 lines).
- `tsc --noEmit` passes with no new errors.
