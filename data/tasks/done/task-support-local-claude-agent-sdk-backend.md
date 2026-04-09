---
id: task-support-local-claude-agent-sdk-backend
title: Support local Claude Agent SDK backend
status: done
priority: p1
area: model
summary: Package the Claude Agent SDK and make local Claude Code a first-class execution backend.
created_at: 2026-03-19
updated_at: 2026-03-19
---

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
