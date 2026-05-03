---
id: task-web-ui-workflow-trigger-form
title: Show input form when manually triggering a parameterized workflow from the web UI
status: ready
priority: p2
area: client
summary: The React web workflow controls trigger each workflow with no payload, while daemon workflow definitions can include inputSchema. Show a generated input form before triggering parameterized workflows so operators do not need to drop to the CLI.
created_at: 2026-04-08T19:09:14Z
updated_at: 2026-05-03T01:37:47.476Z
---

## Source / Intent

Originally dropped in `50622921` as a duplicate of
`task-web-ui-trigger-input-form`, completed in `33f4baa` against the old
`src/web-ui/client-wf-definitions.ts` and `src/web-ui/client-workflows.ts`
implementation. That implementation was replaced by the React client on
2026-04-15 (`01c8919d`). The current daemon control contract includes
`WorkflowDefinitionSummary.inputSchema`, but
`clients/web/src/api/types.ts` omits it and
`clients/web/src/components/sidebar/WorkflowPanel.tsx` calls
`api.triggerWorkflow(name)` with no payload.

## Initiative

Thin-client workflow control parity. Web, macOS, iOS, and CLI clients should
consume the same daemon workflow definition contract and guide operators toward
valid workflow triggers instead of exposing raw names or empty-payload shortcuts.
This pairs with the macOS workflow trigger picker backlog item and the daemon
wire-contract conformance work.

## Problem

The React web UI workflow controls panel has a trigger button for each workflow
that calls `POST /api/workflow/trigger` with an empty payload. This works for
zero-input workflows, but any workflow with an `inputSchema` required field will
either fail or behave incorrectly when triggered with no inputs.

The daemon already returns `inputSchema` on workflow definitions. The web client
type needs to preserve it, and the trigger surface needs to render it.

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
  same data exposed by the daemon definition summary).
- Support string, number, and boolean property types. Unknown types render as text
  inputs.
- No server changes required; the trigger endpoint already accepts an arbitrary
  `payload` object.
- Keep the implementation in the React web dashboard under `clients/web/src/`.
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

## Acceptance Evidence

- A React component test or Playwright test covers a workflow definition with a
  required string/number/boolean input and proves the submitted request includes
  the assembled payload.
- A screenshot under `.kota/runs/<run-id>/` or a Playwright trace/HTML report
  shows the generated workflow trigger form in the web dashboard.
- A regression test covers zero-input workflows triggering immediately.
