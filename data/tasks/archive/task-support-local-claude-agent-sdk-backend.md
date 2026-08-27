---
status: done
---

# Support local Claude Agent SDK backend

## Problem

KOTA needed to work through the packaged Claude Agent SDK and local Claude Code
instead of depending only on direct Anthropic API calls.

## Desired Outcome

Direct runs, delegates, and autonomous workflows should be able to use the same
local Claude-backed execution path.

## Constraints

- Keep backend selection shared instead of duplicating logic per runtime path.
- Do not preserve legacy backend-specific workflow behavior.
- Prefer one clean executor path.

## Done When

- The Claude Agent SDK is packaged into KOTA.
- Local Claude-backed execution works across the main agent paths.
- Backend selection no longer leaks into workflow design.
