---
id: task-split-web-ui-client-ts
title: Split web-ui client.ts into logical section modules
status: ready
priority: p2
area: web-ui
summary: client.ts is 833 lines — nearly 3x the 300-line project limit. Split it into focused section files (sessions, chat, workflows, tasks, approvals, cost, utils) that are composed into the single template literal output, mirroring how web-ui.ts already separates styles.ts from client.ts.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/web-ui/client.ts` is 833 lines and `src/web-ui/styles.ts` is 676 lines.
Both exceed the project 300-line limit. The large size makes the files hard to
navigate and review, and the builder frequently needs to touch this code for UI
changes.

The current design embeds JS and CSS as TypeScript template literals — no build
step, no external files. That design is worth keeping. But the TypeScript source
can still be split into focused section files that export string segments,
assembled in one top-level file.

## Desired Outcome

- `client.ts` is split into section files under `src/web-ui/`:
  - `client-sessions.ts` — session list, create, delete, switch
  - `client-chat.ts` — message rendering, send, SSE streaming
  - `client-workflows.ts` — workflow controls, run list, run detail, step progress, run stream
  - `client-tasks.ts` — task queue panel
  - `client-approvals.ts` — approval panel
  - `client-cost.ts` — cost summary panel
  - `client-utils.ts` — shared utilities (escapeHtml, fmtDuration, renderMarkdown)
  - `client.ts` — assembles sections into the final `WEB_UI_JS` export
- `styles.ts` is split similarly: `styles-layout.ts`, `styles-components.ts`, etc.
- Each resulting file stays under 300 lines.
- All existing tests continue to pass.

## Constraints

- Do not introduce a browser build step. The final output is still a single
  inline JS string.
- The public API (`WEB_UI_JS` from `client.ts`, `WEB_UI_CSS` from `styles.ts`)
  must remain unchanged.
- Runtime behavior must be identical before and after the split.

## Done When

- All new source files are under 300 lines.
- `typecheck`, `lint`, and tests pass.
