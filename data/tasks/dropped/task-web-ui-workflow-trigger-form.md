---
id: task-web-ui-workflow-trigger-form
title: Show input form when manually triggering a parameterized workflow from the web UI
status: dropped
priority: p3
area: web-ui
summary: The workflow controls trigger button fires with no payload. When a workflow definition has an inputSchema, clicking trigger should show a form so operators can supply required inputs without dropping to the CLI.
created_at: 2026-04-08T19:09:14Z
updated_at: 2026-04-08T19:30:00Z
---

## Problem

The web UI workflow controls panel has a trigger button for each workflow that calls
`POST /api/workflow/trigger` with an empty payload. This works fine for zero-input
workflows, but any workflow with an `inputSchema` (required fields) will either fail
or behave incorrectly when triggered with no inputs.

The definitions panel already renders `inputSchema` fields as a reference table, so
the metadata is available on the client. The trigger button just ignores it.

Operators who need to supply inputs must use `kota workflow trigger <name> --payload
'{"key":"value"}'` from the CLI, which defeats the purpose of the operator dashboard.

## Desired Outcome

When an operator clicks the trigger button for a workflow that has an `inputSchema`,
a modal or inline form appears with one input field per schema property (string →
text input, number → number input, boolean → checkbox). Required fields are marked.
The "Trigger" submit button assembles the form values into a payload object and calls
`POST /api/workflow/trigger` with `{ name, payload }`.

For workflows without an `inputSchema`, the button fires immediately (current behavior
unchanged).

## Constraints

- Form is generated from `inputSchema.properties` and `inputSchema.required` (the
  same data already shown in the definitions panel).
- Support string, number, and boolean property types. Unknown types render as text
  inputs.
- No server changes required; the trigger endpoint already accepts an arbitrary
  `payload` object.
- Keep the implementation in `client-workflows.ts` using the same no-dependency
  inline style as the rest of the web UI JS.
- If `inputSchema` is absent or has no `properties`, the button fires immediately
  (no regression for current workflows).

## Done When

- Clicking trigger on a workflow with `inputSchema` shows a form with one field per
  property.
- Required fields are visually marked; submitting with empty required fields is
  blocked with a validation message.
- Submitting the form triggers the workflow via `POST /api/workflow/trigger` with the
  assembled payload.
- Workflows without `inputSchema` trigger immediately (existing behavior preserved).
- No new server routes are added.
