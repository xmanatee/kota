# GitHub Webhook Trigger

The `github-webhook` built-in extension receives GitHub webhook deliveries, validates their
HMAC-SHA256 signatures, and emits typed bus events that KOTA workflows can trigger on.

## How It Works

1. GitHub POSTs a webhook delivery to `POST /api/webhooks/github` on your KOTA server.
2. The extension verifies the `X-Hub-Signature-256` header against the configured secret.
3. If valid, it emits a `github.<event>` bus event with a normalized payload.
4. Any workflow with a matching `event:` trigger fires.

## Configuration

Add to your `.kota/config.json`:

```json
{
  "extensions": {
    "github-webhook": {
      "secret": "$GITHUB_WEBHOOK_SECRET",
      "events": ["push", "pull_request", "check_run"]
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `secret` | Yes | Webhook secret or `$ENV_VAR` reference. Never logged. |
| `events` | No | Event types to accept. Default: `["push", "pull_request", "check_run"]`. |

Set the environment variable before starting the server:

```sh
export GITHUB_WEBHOOK_SECRET=your-secret-here
kota serve
```

## Webhook Endpoint

```
POST /api/webhooks/github
```

The server must be publicly reachable from GitHub. If you use KOTA's auth token, note that this
endpoint is matched by the extension route handler which runs **after** the standard auth check
in `server-routes.ts`. Configure your KOTA server with `noAuth: true` or expose the webhook
endpoint via a reverse proxy that strips auth for this path.

> **Note**: The endpoint is only registered when the extension is configured with a non-empty
> secret. If `secret` is missing or the env var is unset, the route is not registered and the
> server will return 404.

## Setting Up on GitHub

1. Go to your repository (or organisation) → **Settings** → **Webhooks** → **Add webhook**.
2. Set **Payload URL** to `https://your-kota-host/api/webhooks/github`.
3. Set **Content type** to `application/json`.
4. Set **Secret** to the same value as `GITHUB_WEBHOOK_SECRET`.
5. Select **Individual events** and check the types you have in your `events` config.
6. Click **Add webhook**.

## Bus Events

### `github.push`

Emitted on `push` events.

| Field | Description |
|-------|-------------|
| `repo` | `owner/repo` |
| `ref` | Full ref, e.g. `refs/heads/main` |
| `branch` | Short branch name, e.g. `main` |
| `commits` | Number of commits in the push |
| `pusher` | GitHub username of the pusher |

### `github.pull_request`

Emitted on `pull_request` events.

| Field | Description |
|-------|-------------|
| `repo` | `owner/repo` |
| `action` | `opened`, `closed`, `synchronize`, etc. |
| `number` | PR number |
| `title` | PR title |
| `state` | `open` or `closed` |
| `merged` | `true` if the PR was merged |
| `headBranch` | Source branch |
| `baseBranch` | Target branch |

### `github.check_run`

Emitted on `check_run` events.

| Field | Description |
|-------|-------------|
| `repo` | `owner/repo` |
| `action` | `created`, `completed`, etc. |
| `name` | Check run name |
| `status` | `queued`, `in_progress`, `completed` |
| `conclusion` | `success`, `failure`, `neutral`, etc. |

## Workflow Example

Trigger a KOTA workflow whenever a PR is merged to `main`:

```ts
// In your workflow definition:
{
  name: "on-pr-merge",
  trigger: { event: "github.pull_request" },
  when: (payload) =>
    payload.action === "closed" && payload.merged === true && payload.baseBranch === "main",
  steps: [
    { type: "agent", agent: "builder", prompt: "A PR was just merged. Check the queue." },
  ],
}
```

## Security

- Signature validation uses `timingSafeEqual` to prevent timing attacks.
- Deliveries without a valid `X-Hub-Signature-256` header are rejected with HTTP 401.
- The secret is never logged or included in error messages.
- Only event types listed in `events` are processed; others return HTTP 200 with `ignored: true`.
