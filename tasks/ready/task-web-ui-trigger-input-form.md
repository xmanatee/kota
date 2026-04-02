---
id: task-web-ui-trigger-input-form
title: Collect required inputs before triggering workflows with inputSchema from the web UI
status: ready
priority: p3
area: operator-ux
summary: The web UI definitions panel shows that a workflow has required inputs but the Trigger button fires without collecting them, silently sending an empty payload. Workflows with required inputSchema fields fail on the server side with no visible error in the UI.
created_at: 2026-04-02T01:36:00Z
updated_at: 2026-04-02T01:36:00Z
---

## Problem

`client-wf-definitions.ts` renders an "Inputs: field*: type, ..." summary for workflows
that declare `inputSchema`, but `triggerWorkflowByName` in `client-workflows.ts` always
posts `{ name }` with no payload. When a workflow has required fields in `inputSchema`,
the trigger request succeeds (HTTP 200) but the queued run fails immediately at payload
validation because the required fields are absent.

The operator sees the run appear and then fail without understanding why — there is no
prompt to fill in the required fields before clicking Trigger.

## Desired Outcome

When the Trigger button is clicked for a workflow that declares a non-empty `inputSchema`:

- A compact inline form or modal collects the required (and optional) fields before
  the trigger request is sent.
- Field types (`string`, `number`, `boolean`) determine the input type rendered.
- Required fields are marked with `*` and the form blocks submission if they are empty.
- Optional fields are shown but not required.
- On submit, `triggerWorkflowByName` sends the collected values as `payload` in the
  trigger request body.
- Workflows with no `inputSchema` (or an empty one) behave as today — no form, direct trigger.

## Constraints

- Keep the interaction inline or modal within the existing definitions panel — no new panel.
- No external form library; use plain DOM elements consistent with the current web UI style.
- The form must be reachable without JavaScript module changes that break the existing assembly
  pattern (`client-wf-definitions.ts` + `client-workflows.ts` + `client.ts`).
- `triggerWorkflowByName` already accepts a second argument for payload; extend that path
  rather than introducing a parallel trigger function.
- Keep changes within `client-wf-definitions.ts` and `client-workflows.ts`; do not touch
  `web-ui.ts` unless a DOM element must be added.

## Done When

- Clicking Trigger on a workflow with a non-empty `inputSchema` shows a form collecting
  the declared fields before submitting.
- The POST body includes the collected values as `payload`.
- Required fields block submission when empty.
- Workflows without `inputSchema` trigger immediately as before.
- Existing `web-ui.test.ts` snapshot or integration test covers the form rendering path.
