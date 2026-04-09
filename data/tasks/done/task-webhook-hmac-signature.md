---
id: task-webhook-hmac-signature
title: Replace webhook bearer-token auth with HMAC-SHA256 signature verification
status: done
priority: p2
area: runtime
summary: Inbound webhooks are currently authenticated by comparing a shared secret sent in a request header. Switching to HMAC-SHA256 body signature verification removes the secret from headers, prevents replay attacks with a timestamp check, and aligns with the pattern used by GitHub, Stripe, Slack, and other common webhook senders.
created_at: 2026-04-01T08:14:00Z
updated_at: 2026-04-01T08:30:00Z
---

## Problem

`daemon-control-webhook.ts` authenticates inbound webhook requests by requiring the caller
to pass the raw shared secret in `X-Kota-Webhook-Secret`. This approach has two weaknesses:

1. The secret travels in the HTTP header on every request, making it visible to any
   intermediary (proxy, load balancer, logging pipeline) that records headers.
2. There is no replay protection — a captured valid request can be replayed indefinitely.

External webhook senders (GitHub Actions, Stripe, Slack, etc.) use HMAC-SHA256 body
signatures: the caller signs the request body with the shared secret and sends
`X-Hub-Signature-256: sha256=<hex>` (or equivalent). The server recomputes the signature
and compares — the secret never travels over the wire, and a timestamp in the payload
or header provides replay protection.

## Desired Outcome

Webhook authentication uses HMAC-SHA256 body signature verification:

- The server computes `HMAC-SHA256(secret, rawBody)` and compares it to the value in
  `X-Kota-Webhook-Signature` (format: `sha256=<hex>`).
- Optionally, a `X-Kota-Webhook-Timestamp` header is checked against the current time
  (default: reject requests older than 5 minutes) to prevent replay attacks.
- The existing `X-Kota-Webhook-Secret` bearer-token path is removed; callers must sign.
- `kota webhook secret generate` output and `docs/` are updated to show the new signing
  pattern with a code snippet for common senders (Node.js `crypto.createHmac`).

Migration path: one release of deprecation warning when the old header is present, then
removal. Alternatively, a clean break is acceptable since webhooks require explicit config.

## Constraints

- Use Node.js built-in `crypto.createHmac` — no new dependencies.
- The timing-safe comparison must use `crypto.timingSafeEqual` to avoid timing attacks.
- Keep changes inside `src/scheduler/daemon-control-webhook.ts` and `src/webhook-cli.ts`.
- Update `docs/DAEMON-API.md` webhook section with the new signing spec.
- Update existing webhook integration tests to sign requests with the new scheme.

## Done When

- Inbound webhook requests are authenticated via `X-Kota-Webhook-Signature: sha256=<hex>`.
- The old `X-Kota-Webhook-Secret` bearer header is no longer accepted.
- Optional timestamp replay window is enforced when `X-Kota-Webhook-Timestamp` is present.
- Integration tests use the new signing scheme and pass.
- `docs/DAEMON-API.md` documents the signing format with a code example.
