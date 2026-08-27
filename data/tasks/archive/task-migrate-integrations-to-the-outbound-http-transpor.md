---
status: done
---

# Migrate integrations to the outbound HTTP transport

## Problem

After the canonical transport exists, KOTA will still have integration-owned
request wrappers and raw fetch calls across GitHub, Linear, Jira, Google
Workspace, Slack, Telegram, push notifications, skill/registry downloads,
model clients, embeddings, transcription, speech, MCP, and foreign modules.
Leaving both paths would make the new transport optional and preserve the
drift this initiative is intended to remove.

## Desired Outcome

Migrate every core/module outbound integration to the appropriate canonical
transport profile, retain only protocol shaping in each adapter, and delete
superseded timeout/redirect/error/retry/fetch helpers.

## Constraints

- Migrate by trust boundary, not with a broad textual replacement. Record the
  selected profile and credential/redirect behavior for every adapter.
- Preserve vendor-specific pagination, OAuth refresh, streaming, and error
  payload handling above the transport.
- Do not silently retry non-idempotent writes. Retry eligibility comes from
  method/idempotency metadata and the shared policy.
- Client-to-daemon transports may remain platform-local implementations, but
  each client must have one internal request path; direct route exceptions are
  not allowed.
- Remove old wrappers in the same slice that migrates their final caller.

## Done When

- All audited core/module integrations use a named canonical profile and no
  production module calls global `fetch` directly.
- Web/mobile daemon clients route JSON, streaming, sessions, and voice through
  their single client transport rather than direct per-route fetches.
- Duplicate abort/timeout, response parsing, retry, redaction, and redirect
  helpers are deleted where the shared transport owns them.
- Module health/readiness surfaces expose typed transport configuration or
  failure without logging credentials.

## Source / Intent

The 2026-07-31 audit counted about 60 non-fixture fetch calls in 31 files and
confirmed multiple local wrappers with different policies. This task is the
mandatory migration slice after the transport foundation; it prevents a new
shared helper from becoming merely one more option.

## Initiative

One canonical capability mechanism per KOTA boundary.

## Acceptance Evidence

- A before/after call-site inventory mapping every audited fetch path to its
  canonical profile and protocol adapter.
- Live or deterministic provider probes for at least one OAuth integration,
  one webhook/channel, one model/embedding provider, one registry download,
  one MCP endpoint, and each client daemon transport.
- A structural search showing no disallowed production global `fetch`, stale
  transport helper, or fallback request path remains.

## Completion

Core and module integrations now enter the policy-aware outbound HTTP port.
Vendor adapters retain protocol-shaped functions named `fetch`, while the only
global network primitive is the outbound dispatcher. Web and mobile each keep
one client-local daemon transport, which is the explicit boundary allowed by
this task.
