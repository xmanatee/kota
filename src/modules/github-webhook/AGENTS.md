# GitHub Webhook Module

This directory owns the GitHub webhook ingestion module — receives GitHub webhook deliveries and emits typed bus events.

- Registers `POST /api/webhooks/github` and validates each delivery's `X-Hub-Signature-256` HMAC before emitting `github.<event>` bus events.
- Requires `modules.github-webhook.secret` (or `$GITHUB_WEBHOOK_SECRET` env var). The route is not registered when the secret is missing.
- Invalid signatures are rejected with HTTP 401; unrecognised event types return HTTP 200 with `ignored: true`.
- Signature validation uses `timingSafeEqual` to prevent timing attacks.

## Config

```json
{
  "modules": {
    "github-webhook": {
      "secret": "$GITHUB_WEBHOOK_SECRET",
      "events": ["push", "pull_request", "check_run"]
    }
  }
}
```

`events` defaults to `["push", "pull_request", "check_run"]` when omitted.

## GitHub Setup

On GitHub: repository Settings > Webhooks > Add webhook. Set the payload URL to
`https://<your-kota-host>/api/webhooks/github`, content type to `application/json`,
and the secret to the same value as `GITHUB_WEBHOOK_SECRET`. Select the event
types matching your `events` config.

## Bus Events

If you add or change a field in a normalized payload, update the corresponding
table below in the same commit.

- `github.push` — `repo`, `ref`, `branch`, `commits` (count), `pusher`
- `github.pull_request` — `repo`, `action`, `number`, `title`, `state`, `merged`, `headBranch`, `baseBranch`, `headRepo`, `isFork`
- `github.check_run` — `repo`, `action`, `name`, `status`, `conclusion`

## Boundaries

- Does not own GitHub API calls or PR/issue tools (those belong in `github/`).
- Does not own inbound webhook routing for other services (other webhook modules are separate).
- Does not own outbound HTTP notification delivery (that belongs in `webhook/`).
