---
id: task-add-module-setup-and-auth-requirement-protocol
title: Add module setup and auth requirement protocol
status: done
priority: p1
area: modules
summary: Let modules declare structured setup, config, secret, OAuth, reauth, and health requirements that every client can render and satisfy without exposing credentials to agents or prompts.
depends_on: [task-promote-projects-into-hierarchical-scopes]
created_at: 2026-06-03T13:40:18.801Z
updated_at: 2026-06-04T10:26:00.000Z
---

## Problem

Modules that need credentials or setup currently rely on a mix of config
schemas, secrets commands, env vars, capability readiness, warnings, and
module-specific docs. Telegram reads `TELEGRAM_BOT_TOKEN`, Google Workspace
uses OAuth refresh-token config/env refs, model clients use provider config,
browser auth uses storage state, and secrets are available through a separate
module. Clients cannot render one consistent setup or reauth experience.

The owner wants auth and required configuration to be protocolized so any
module can declare what it needs and any client can surface and satisfy those
requirements without exposing credentials to prompts or agents.

## Desired Outcome

Add a module setup/auth requirement protocol. A module can declare structured
requirements such as config field, secret, OAuth connection, browser profile,
external URL setup, capability probe, reauth, and optional settings. The daemon
exposes these requirements and their current status through a typed control API
that every client can render.

The protocol should define:

- Requirement ids, display metadata, sensitivity, scope, and owner.
- Form-mode setup for non-sensitive settings.
- URL-mode setup for OAuth or sensitive credential collection.
- Secret storage references that never expose values to LLM context.
- Refresh/reauth lifecycle, including expired/revoked/unknown states.
- Health checks that connect setup status to capability readiness.
- Persistence rules for config, secrets, tokens, and pending setup actions.

## Constraints

- Do not store raw secrets in task files, logs, prompts, run summaries,
  screenshots, or client-visible JSON.
- Reuse and tighten existing config slices, module config schemas, and the
  secrets provider chain instead of inventing a separate settings store.
- Sensitive values must be collected through a secret/OAuth path, not normal
  form payloads.
- Clients must render the same requirement contract. CLI, web, macOS/iOS, and
  mobile can differ visually but not semantically.
- Missing setup should produce typed disabled/unavailable state, not silent
  module partial startup.
- Keep module setup requirements module-owned; core owns only the protocol,
  validation, store boundary, and control API.

## Done When

- `KotaModule` can declare setup/auth requirements with strict TypeScript
  types and runtime validation.
- Daemon control API exposes setup requirement status and supports submitting
  non-sensitive settings, storing secret references, starting URL/OAuth setup,
  completing setup, refreshing health, and revoking/removing credentials.
- Secrets and tokens are stored through the existing secret/provider layer or a
  clearly documented extension of it; LLM tools receive only opaque references
  or capability availability.
- Telegram, Google Workspace, model clients, and browser/auth-walled source
  access migrate at least one requirement each onto the protocol.
- Client conformance fixtures include setup requirements and status arms.
- Tests cover missing config, accepted form setup, sensitive URL setup,
  expired credential/reauth, revocation, and capability readiness updates.

## Source / Intent

Owner request from `data/inbox/many.md` and follow-up on 2026-06-03:
"modules that need auth or tokens ... should have a clear flow to auth" and
"auth should be protocolized and any client should support authing ... where
and how credentials and other settings will be stored and how will it be
refreshed and accessed and checked."

Relevant current code: `src/core/modules/module-types.ts`,
`src/core/config/config-slice.ts`, `src/core/config/secrets.ts`,
`src/modules/secrets/`, `src/modules/telegram/index.ts`,
`src/modules/google-workspace/index.ts`, `src/modules/model-clients/`, and
`src/modules/browser/`.

Research references: Home Assistant config flows and reauth
(`https://developers.home-assistant.io/docs/core/integration/config_flow/`) and
MCP elicitation form/url mode
(`https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation`).

## Initiative

Protocolized setup and credential lifecycle: modules declare needs once, every
client satisfies them consistently, and agents never see raw credentials.

## Acceptance Evidence

- Typecheck and tests for module setup requirement validation and daemon
  routes.
- Updated conformance fixture showing setup/auth status arms.
- CLI transcript under `.kota/runs/<run-id>/transcript.txt` showing a
  non-sensitive setup flow and a redacted sensitive setup flow.
- Web or native rendered fixture/screenshot showing the same setup requirement
  states without exposing secrets.
