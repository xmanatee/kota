---
id: task-complete-setup-auth-client-rendering-and-evidence
title: Complete setup auth client rendering and evidence
status: backlog
priority: p2
area: client
summary: Close the setup/auth rollout gap by rendering the same requirement states and safe collection actions through shared client surfaces with transcript/screenshot evidence.
depends_on: [task-add-shared-ui-contribution-protocol-across-clients]
created_at: 2026-06-04T13:06:53.015Z
updated_at: 2026-06-04T13:06:53.015Z
---

## Problem

`task-add-module-setup-and-auth-requirement-protocol` is in `done/` and the core
protocol plus client conformance decoders exist, but the task's own acceptance
evidence calls for client-rendered proof:

- CLI transcript showing non-sensitive setup and redacted sensitive setup.
- Web or native rendered fixture/screenshot showing the same setup states.

Current client changes primarily add typed fixtures/decoders. They do not yet
prove that setup/auth requirements are rendered and satisfied consistently
across the shared UI surfaces the owner asked for.

## Desired Outcome

Render setup/auth requirements through the shared UI contribution protocol and
prove parity across clients. The surfaced flow should include missing, pending,
ready, expired, revoked, and unavailable states; non-sensitive form setup; URL
or OAuth setup; and safe secret collection actions.

This task closes the client evidence gap without changing the core setup/auth
protocol unless the renderer reveals a protocol defect.

## Constraints

- Depends on the shared UI contribution protocol; do not hardcode another
  one-off setup screen model in each client.
- Do not expose raw secrets in rendered fixtures, screenshots, transcripts,
  daemon JSON, or test snapshots.
- Do not duplicate setup/auth semantics in clients. Clients render the daemon
  contract and call typed setup actions.
- Keep CLI, web, Apple, and mobile semantically aligned even if the visual
  renderers differ.

## Done When

- Shared UI contribution fixtures include setup/auth requirement states and
  actions.
- CLI renders the setup/auth surface and captures a transcript showing
  non-sensitive setup plus redacted sensitive setup.
- At least one visual client renders the same setup/auth states with screenshot
  or snapshot evidence.
- Swift/mobile/web decoders accept the same fixture and reject malformed setup
  UI/action declarations.

## Source / Intent

Owner request from the architecture review: modules requiring auth or tokens
should declare setup requirements that any client can surface and satisfy. This
also follows the completed setup/auth protocol task's acceptance evidence, which
was not fully satisfied by decoder-only client support.

## Initiative

One daemon UI protocol, many renderers.

## Acceptance Evidence

- CLI transcript under `.kota/runs/<run-id>/transcript.txt` showing redacted
  sensitive setup output.
- Web screenshot, native snapshot, or mobile rendered fixture showing the same
  setup/auth states.
- Cross-client conformance output proving all clients consume the same setup UI
  contribution fixture.
