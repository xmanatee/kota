# Webhook Module

This directory owns:

- The generic inbound HTTP→bus event-trigger surface used by external
  systems (CI, ad-hoc curl, non-GitHub webhooks) to fire a typed bus
  event by name with a JSON payload.
- The outbound webhook notification channel that POSTs event payloads
  to configured operator endpoints.
- The CLI commands for managing inbound webhook trigger secrets stored
  in `.kota/config.json`.

## Inbound event-trigger surface

- One route, contributed through `KotaModule.routes`:
  `POST /api/events/:name` with a JSON body.
- The route is bearer-token-protected by the server's standard `/api/*`
  auth — there is no `bypassAuth` here and no per-route signature
  verification. (For HMAC-validated GitHub deliveries, see
  `github-webhook/`. For per-workflow signed triggers, see
  daemon-control's `/webhooks/<workflow>`.)
- The handler reaches the bus through `ctx.events.emit` rather than
  importing the core event bus directly. The response echoes the event
  name and the current listener count (`listeners`), useful for ad-hoc
  smoke checks of trigger wiring.
- Event names are URL-decoded; an event name must be 1–256 characters
  after decoding. Malformed percent-encoding returns 400.

## Outbound notifications

- POST event payloads to configured operator endpoints.
- Optional event filters must not suppress urgent owner/approval
  escalation notifications (`approval.requested`,
  `owner.question.asked`).
- Uses `postWithRetry` from the `notification` module for delivery with
  exponential-backoff retry.

## CLI

- `kota webhook list`, `kota webhook secret generate`,
  `kota webhook secret remove` manage inbound webhook trigger secrets
  used by daemon-control's signed `/webhooks/<workflow>` route.

## Boundaries

- Owns the generic `POST /api/events/:name` inbound surface. Does not
  own provider-specific inbound webhook receivers — `github-webhook/`
  owns GitHub deliveries; future provider-specific receivers belong in
  their own modules.
- Does not own per-workflow signed `/webhooks/<workflow>` triggers
  (those live on the daemon-control surface, with secret material
  managed by this module's CLI).
- Does not own Slack or Telegram notification (those belong in
  `slack/` and `telegram/`).
- Does not own retry logic (that lives in the `notification` module).
