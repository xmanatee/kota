---
id: task-replace-macos-workflow-trigger-text-entry-with-def
title: Replace macOS workflow trigger text entry with definitions picker
status: ready
priority: p2
area: client
summary: Use the daemon workflow definitions endpoint in the macOS menu-bar app so triggering a workflow is a selectable, schema-aware action instead of a fragile free-text workflow-name dialog.
created_at: 2026-04-28T22:35:35.379Z
updated_at: 2026-05-03T00:52:39.198Z
---

## Problem

The macOS menu bar still triggers workflows through a free-text field:
`clients/macos/Sources/KotaMenuBar/TriggerWorkflowView.swift` asks for
"Workflow name (e.g. builder)". That matched the initial menu-bar task, but the
daemon now exposes workflow definitions. Operators should not have to memorize
workflow names or input schema details.

## Desired Outcome

The macOS workflow trigger surface uses daemon workflow definitions:

- list selectable workflows by display/name;
- show enabled/disabled or trigger metadata where useful;
- render required input fields from `inputSchema` where available;
- validate payload before sending;
- submit through the existing daemon trigger endpoint;
- present clear errors for unavailable definitions, validation failure, or HTTP
  failure.

## Constraints

- Keep the macOS client thin and use daemon API data only.
- Do not hardcode built-in workflow names.
- Coordinate with `task-define-and-enforce-thin-client-capability-contract` if
  the shared client contract changes the definitions shape.
- Preserve a path for advanced/manual JSON payloads only if existing workflow
  semantics need it; the primary path should be selection, not raw text.
- Add tests and rendered evidence.

## Done When

- `TriggerWorkflowView` no longer relies on a raw workflow-name text field as
  the primary trigger mechanism.
- `DaemonClient` exposes and tests workflow definitions if it does not already.
- Workflow input-schema fields are represented or explicitly handled.
- Errors are actionable and body-aware.
- A screenshot or rendered artifact shows the picker with at least two
  workflows and a trigger-ready state.

## Source / Intent

Owner feedback on 2026-04-28 flagged the free-text workflow dialog as a broken
UX. The original 2026-04-01 menu-bar task requested a minimal "Trigger..."
dialog by name, but the daemon/client architecture has since grown a workflow
definitions API and input-schema support.

## Initiative

Workflow operator ergonomics: clients should guide valid workflow triggers
instead of asking operators to remember internal names.

## Acceptance Evidence

- Swift build/test output.
- Screenshot or rendered artifact of the definitions picker and validation
  behavior.
- DaemonClient test proving definitions are decoded and trigger requests still
  use the correct endpoint/body.
