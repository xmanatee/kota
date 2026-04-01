---
id: task-web-ui-thinking-block-viewer
title: Display extended thinking blocks in the web UI run detail view
status: done
priority: p3
area: operator-ux
summary: The thinkingEnabled/thinkingBudget feature lets workflow agent steps use extended thinking, but the thinking content is not surfaced in the web UI run detail view. Operators cannot inspect the model's reasoning without reading raw run logs.
created_at: 2026-03-31T14:10:00Z
updated_at: 2026-03-31T14:10:00Z
---

## Problem

Workflow agent steps can now enable extended thinking via `thinkingEnabled` and `thinkingBudget`. When active, Claude emits thinking blocks alongside text blocks. These blocks contain the model's chain-of-thought reasoning. Currently this content either passes through log output or is discarded — there is no dedicated display in the web UI run detail panel. Operators who want to understand why a builder or explorer made a particular decision must grep raw logs.

## Desired Outcome

The web UI run detail view detects thinking blocks in step output and renders them in a collapsible "Thinking" section above the corresponding text output. The section is collapsed by default (to avoid overwhelming the view) and expands on click. Thinking content is rendered as plain preformatted text. No new server routes are needed if thinking content is already included in the run log lines stored in run artifacts.

## Constraints

- Client-side rendering only if the thinking content is already present in stored log lines; no new server routes unless required.
- Collapsed by default; expand on click with a disclosure triangle or similar affordance.
- Do not alter how thinking content is stored or logged in the backend; surface what is already there.
- If thinking blocks are not currently stored in run artifacts, the task scope includes adding minimal storage of thinking block content to the run artifact writer before surfacing it in the UI.

## Done When

- The web UI run detail view shows a collapsible "Thinking" section for any step that produced extended thinking output.
- The section is collapsed by default and expands on click.
- A manual test with a thinking-enabled workflow step confirms the content appears correctly.
- Existing web UI tests pass.
