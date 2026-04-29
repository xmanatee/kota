---
id: task-rework-macos-menu-bar-into-an-operator-first-comma
title: Rework macOS menu bar into an operator-first command center
status: done
priority: p1
area: client
summary: Consolidate the overloaded macOS menu-bar popover from one collapsible section per backend seam into a compact operator-first IA with status/runs, approvals/questions, a unified search/action surface, and settings, preserving existing daemon functionality while making the app usable.
created_at: 2026-04-28T22:35:28.133Z
updated_at: 2026-04-29T03:31:21.843Z
---

## Problem

The macOS menu bar app grew by capability fan-out. Each new backend seam added
another collapsible section into the same narrow popover: Digest, Attention,
Knowledge, Memory, History, Tasks, Recall, Answer, Capture, Retract, Sessions,
plus footer actions and settings.

That preserves API parity but creates a poor operator experience:

- too many sections compete in a 280px-wide menu;
- several sections expose raw backend state rather than a focused workflow;
- errors from optional/unavailable providers dominate the UI;
- "Trigger Workflow" is hidden behind a free-text dialog;
- "Open Dashboard" can open `localhost:3000` even when no dashboard is served;
- the notification toggle and footer actions feel visually misaligned.

## Desired Outcome

The menu bar becomes a compact operator command center:

- first viewport: daemon health, active runs, approvals/questions requiring
  attention, and clear project/connection state;
- one unified command/search area for knowledge, memory, history, tasks, recall,
  and answer, using capability readiness to show available sources;
- capture/retract remain accessible but not visually equal to passive status;
- workflow trigger uses definitions instead of raw free text;
- dashboard action is shown only when available and opens the correct URL;
- settings/project/notification controls are visually calm and aligned;
- all existing daemon-backed functions remain reachable.

## Constraints

- Keep the macOS app thin: no direct `.kota` reads except daemon-control
  discovery, no embedded KOTA runtime, no duplicated provider logic.
- Do not remove capability coverage merely to make the UI smaller. Consolidate
  and prioritize it.
- Use daemon readiness and definitions contracts where available; if those
  contracts are not landed yet, gate this task behind or coordinate with the
  relevant ready tasks.
- Add rendered/visual evidence. This task cannot be accepted on Swift build/test
  alone.
- Preserve accessibility and keyboard usability for search/action flows.

## Done When

- `MenuBarView` no longer presents one top-level collapsible section per backend
  seam.
- Core operator flows are grouped by intent: monitor, respond, search/ask,
  capture/correct, configure.
- Workflow trigger, dashboard open, and notification controls use the improved
  contracts/presentation.
- Swift tests cover state/view model behavior, and rendered screenshots cover
  connected, degraded, unavailable-provider, and offline states.
- The menu bar is usable at its current popover width without incoherent
  overlap, clipped primary labels, or a wall of unrelated red errors.

## Source / Intent

Owner feedback on 2026-04-28: "generally the whole app feels overloaded...
there is good functionality, but the UX is poorly designed and some things are
broken." Investigation found this was not one bad view; it was the result of a
fan-out task pattern where each capability asked builders to mirror the previous
section and wire it into `MenuBarView`.

## Initiative

Operator UX consolidation: surface parity should produce a usable command
center, not an inventory of backend seams.

## Acceptance Evidence

- Screenshots under `.kota/runs/<run-id>/` for online/running, offline,
  degraded-provider, and workflow-trigger states.
- Swift build/test output.
- A short IA note in the run artifact mapping old sections to the new operator
  workflows so reviewers can verify no capability disappeared.
