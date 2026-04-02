# Triggering KOTA Workflows from GitHub Actions

KOTA's daemon exposes a signed webhook endpoint (`POST /webhooks/:workflowName`) that any
HTTP client can call. This guide shows how to trigger a KOTA workflow from a GitHub Actions
job.

## Prerequisites

- A KOTA daemon is running (`kota daemon start`).
- The workflow you want to trigger has `triggers: [{ webhook: true }]` in its definition.
- The CI runner can reach the daemon's control API (see [Network Access](#network-access)).

## 1. Configure the Workflow

Add a webhook trigger to your workflow definition:

```typescript
export const myWorkflow: WorkflowDef = {
  name: "on-push",
  triggers: [{ webhook: true }],
  steps: [
    { type: "agent", agent: "builder", prompt: "A push was just made. Check the queue." },
  ],
};
```

## 2. Generate a Webhook Secret

Run `kota webhook secret generate <workflow-name>` to create a cryptographically random
secret and write it to `.kota/config.json`:

```sh
kota webhook secret generate on-push
```

The command prints the secret once. Copy it — you'll need it in the next step.

> `.kota/config.json` contains the raw secret. Keep it gitignored.

## 3. Add the Secret to GitHub

1. Go to your repository → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**.
3. Name: `KOTA_WEBHOOK_SECRET`
4. Value: the secret printed by the previous command.
5. Click **Add secret**.

Also store the daemon's base URL as a secret or variable (see [Network Access](#network-access)
for how to find it):

- `KOTA_DAEMON_URL` — e.g. `http://127.0.0.1:51234` (the `http://127.0.0.1:<port>` value
  from `.kota/daemon-control.json`)

## 4. Add the GitHub Actions Step

Compute the HMAC-SHA256 signature in bash and POST to the webhook endpoint. A complete
example lives in [`examples/github-actions/kota-trigger.yml`](../examples/github-actions/kota-trigger.yml).

**Key signing one-liner** (works on Ubuntu and macOS runners):

```sh
PAYLOAD='{"ref":"refs/heads/main","repo":"owner/repo"}'
TIMESTAMP=$(date +%s%3N)  # Unix ms
SIG=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$KOTA_WEBHOOK_SECRET" | awk '{print "sha256="$2}')

curl -sf -X POST "$KOTA_DAEMON_URL/webhooks/on-push" \
  -H "Content-Type: application/json" \
  -H "X-Kota-Webhook-Signature: $SIG" \
  -H "X-Kota-Webhook-Timestamp: $TIMESTAMP" \
  -d "$PAYLOAD"
```

`X-Kota-Webhook-Timestamp` is optional but recommended — it prevents replay attacks by
rejecting requests older than 5 minutes.

The daemon responds with `200 {"runId":"..."}` on success.

## Network Access

The daemon's control API binds to `127.0.0.1` (loopback) with a dynamically assigned port.
The port is written to `.kota/daemon-control.json` when the daemon starts.

GitHub-hosted runners cannot reach a loopback address on your machine. Two practical options:

### Option A: Self-hosted runner (recommended)

Run a GitHub Actions [self-hosted runner](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners)
on the same machine as the KOTA daemon. The runner can reach `127.0.0.1` directly.

Read the port at workflow start:

```sh
DAEMON_PORT=$(jq -r .port /path/to/project/.kota/daemon-control.json)
KOTA_DAEMON_URL="http://127.0.0.1:$DAEMON_PORT"
```

Or pass the URL as a repository variable set to a static value if you pin the port
via `daemon.port` in `kota.config`.

### Option B: SSH tunnel from a cloud runner

On the machine running the daemon, set up an SSH server. In the Actions job, open a
local SSH tunnel so the runner can reach the daemon's loopback port:

```sh
# DAEMON_PORT: store as a GitHub Actions secret or variable (use a static port
# via daemon.port in kota.config so you know it in advance).
ssh -fNT -L 19000:127.0.0.1:$DAEMON_PORT user@your-host
KOTA_DAEMON_URL="http://127.0.0.1:19000"
```

`-L` forwards a local port on the runner to a port on the remote machine.
`-R` (reverse tunnel) would do the opposite and is not what you want here.

This is more complex; Option A is simpler for teams that own their infrastructure.

## Payload and Workflow Access

The JSON body you POST is available to workflow steps as `stepOutputs.trigger.body`:

```typescript
steps: [
  {
    type: "agent",
    agent: "builder",
    prompt: `Repo {{trigger.body.repo}} pushed {{trigger.body.ref}}.`,
  },
],
```

Headers (excluding the signature) are in `stepOutputs.trigger.headers`.

## Verifying the Setup

```sh
# Check that the workflow has a secret configured
kota webhook list

# Trigger manually for a quick smoke test
PAYLOAD='{"test":true}'
SIG=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "YOUR_SECRET" | awk '{print "sha256="$2}')
curl -v -X POST "http://127.0.0.1:$(jq -r .port .kota/daemon-control.json)/webhooks/on-push" \
  -H "Content-Type: application/json" \
  -H "X-Kota-Webhook-Signature: $SIG" \
  -d "$PAYLOAD"
```

A `200 {"runId":"..."}` response confirms the endpoint is reachable and the secret is correct.

## See Also

- [Webhook trigger reference](./WORKFLOWS.md#inbound-webhook)
- [Daemon API webhook endpoint](./DAEMON-API.md#webhook-trigger-endpoint)
- [`kota webhook` CLI reference](./CONFIG.md)
