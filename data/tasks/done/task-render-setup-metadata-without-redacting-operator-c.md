---
id: task-render-setup-metadata-without-redacting-operator-c
title: Render setup metadata without redacting operator controls
status: done
priority: p1
area: client
task_class: Product
summary: Project setup status field by field so secrets stay hidden while requirement IDs, reasons, paths, and actions remain usable.
created_at: 2026-08-24T02:13:40.033Z
updated_at: 2026-08-26T03:02:11.396Z
---

## Problem

The generic evidence scrubber is applied to complete setup-status objects. It
redacts non-secret requirement IDs, OAuth labels, config paths, reasons, and
pending actions, so `kota setup list` can hide the exact identifier or action
the operator must use.

## Desired Outcome

Give setup requirements a typed client projection that preserves operational
metadata and redacts only secret values or explicitly sensitive provider
payloads. CLI, daemon API, inbox, and shared UI render the same actionable
status without leaking credentials.

## Constraints

- Do not weaken secret handling or expose raw OAuth tokens, API keys, secret
  values, authorization codes, or provider responses.
- Requirement IDs, module names, titles, states, reason codes, safe config
  paths, secret-reference names, and available actions are metadata, not secret
  prose.
- Replace whole-object regex projection at the setup boundary; do not add
  exceptions to the global prose scrubber.
- Keep full/summary/hidden scope-visibility behavior explicit and typed.
- Every suggested command must be executable with the displayed identifier.

## Done When

- Current OpenRouter, Anthropic, OpenAI, Google Workspace, SMTP, Slack, and
  Telegram setup rows show stable usable identifiers and actions while their
  secret values remain absent.
- CLI, inbox, daemon JSON, and shared UI agree on the projected fields.
- Adversarial secret-shaped values are redacted without redacting ordinary
  labels containing words such as token, credential, OAuth, or API key.
- A complete operator can follow the rendered remediation from missing or
  revoked state to ready without inspecting configuration files manually.

## Source / Intent

Owner-approved operator defect from the 2026-08-24 audit. Live output showed
`model-clients/[redacted]`, `google-workspace/[redacted]`, redacted revoked
reasons/actions, and redacted config paths even under full visibility.

## Initiative

Operator-completable canonical setup and onboarding.

## Acceptance Evidence

- Rendered production-CLI capture at
  `.kota/runs/2026-08-24T12-19-13-793Z-builder-vw6ajf/evidence/artifacts/setup-provider-controls.png`,
  with secrets absent and displayed commands executable.
- Daemon/shared-UI rendered fixtures for the same structured projection.
- Negative fixture containing real secret-shaped values and safe labels that
  share secret-related words.
