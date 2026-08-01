---
id: task-add-one-policy-aware-outbound-http-transport
title: Add one policy-aware outbound HTTP transport
status: done
priority: p1
area: architecture
task_class: Platform
summary: Define one typed outbound HTTP transport with explicit trust profiles and shared timeout, redirect, body-limit, redaction, and error semantics.
created_at: 2026-07-31T16:00:59.628Z
updated_at: 2026-08-01T19:09:48.492Z
---

## Problem

KOTA has a strong public-target fetcher in
`src/modules/web-access/private-network.ts`, but provider adapters, OAuth,
MCP, registry installers, notifications, task integrations, model/audio
providers, and daemon clients each wrap or call global `fetch` independently.
An audit found roughly 60 non-fixture call sites across 31 files. Timeout,
redirect, private-network, credential-forwarding, body-limit, error, retry,
and telemetry behavior is therefore inconsistent.

Not every call should use public-web SSRF policy: loopback daemon control,
configured provider endpoints, OAuth discovery/token exchange, public
untrusted URLs, and callbacks have different trust boundaries. The missing
abstraction is one transport with explicit policy profiles, not one permissive
wrapper.

## Desired Outcome

Introduce one typed outbound HTTP transport primitive used by KOTA core and
modules. Every request selects a named trust/effect profile whose policy owns
target validation, redirects, credentials, timeout, response limits,
structured errors, redaction, retry eligibility, and telemetry.

## Constraints

- Do not move browser automation into HTTP. `web-access` remains the
  agent-facing public/static source capability and `browser` remains the sole
  Playwright/rendered/authenticated capability.
- Preserve protocol-specific clients (MCP, OAuth, OpenAI, Slack, etc.) as thin
  adapters over the shared transport; do not flatten vendor semantics into a
  god client.
- Profiles must be closed typed values with fail-closed defaults. Callers may
  not pass arbitrary booleans to disable policy.
- Cross-origin redirects must never forward credentials unless the selected
  protocol explicitly proves that behavior safe.
- Use dependency injection at the transport boundary for deterministic
  fixtures; do not retain per-module `fetch` dialects as public mechanisms.

## Done When

- One owner module/core boundary defines request/response/error types and named
  profiles for public untrusted, configured provider, OAuth protected
  resource, daemon loopback, and explicit callback traffic.
- The existing web-access redirect/private-network protections are expressed
  through that boundary without weakening them.
- Timeout, abort, size limit, redirect, redaction, retry eligibility, and
  telemetry behavior are implemented once and covered per profile.
- A structural rule identifies allowed low-level adapters and rejects new raw
  global `fetch` use elsewhere.

## Source / Intent

Owner request on 2026-07-31: internet access and other shared actions should
have one reliable mechanism instead of independent wrappers. Audit evidence
found direct production fetch paths in core MCP/server code and GitHub,
Linear, Jira, Google Workspace, Slack, Telegram, model, voice, semantic,
registry, skill, and notification modules. Browser ownership itself was
already clean and is intentionally preserved.

## Initiative

One canonical capability mechanism per KOTA boundary.

## Acceptance Evidence

- A transport policy matrix artifact listing each profile, allowed targets,
  credential/redirect rules, limits, retry eligibility, and owning call sites.
- Focused fixture output for DNS/private-target rejection, cross-origin
  redirect credential stripping, timeout/abort, oversized body, redaction, and
  typed provider errors.
- A repository search/architecture-check artifact proving raw `fetch` is
  limited to the named low-level transport adapters and client-platform roots.

## Completion Evidence

- Added the typed profile/transport boundary under `src/core/outbound-http/`,
  migrated `web-access` and the core daemon health probe, and removed the
  former module-local private-network transport.
- Added the TypeScript-AST raw-fetch ratchet in
  `src/outbound-http-fetch-policy.integration.test.ts`; the 28-file legacy
  baseline records exact normalized call-site signatures, is assigned to the
  dependent integration-migration task, and cannot grow or be replaced by a
  different same-count call site.
- Typecheck, production build, focused transport/web fixtures, structural
  policy gates, and the affected shipped-CLI/replay fixtures pass.
- The policy matrix, focused fixture transcript, raw-fetch architecture check,
  and validation summary are projected from
  `.kota/runs/2026-08-01T18-16-04-612Z-builder-qx1db9/evidence/artifacts/`.
