# Configuration Reference

## First-time setup

Run `kota init` in a new directory to scaffold the required project structure:
- `kota.config.ts` — project config with commented-out extension blocks
- `tasks/` — task queue subdirectories (`inbox/`, `ready/`, `doing/`, `backlog/`, `blocked/`, `done/`, `dropped/`)
- `docs/` — documentation directory
- `.kota/` — runtime state directory

`kota init` is idempotent: running it again skips existing files. Pass `--force` to overwrite `kota.config.ts` only. After scaffolding, run `kota doctor` to verify the setup.

## Config files

KOTA loads config from two JSON files merged in order (project overrides global):

- Global: `~/.kota/config.json`
- Project: `.kota/config.json` (gitignored; use for secrets and project-local overrides)

CLI flags take highest precedence over both files.

## Log settings

```json
{
  "log": {
    "format": "text"
  }
}
```

| Field | Values | Default | Description |
|-------|--------|---------|-------------|
| `log.format` | `"text"` \| `"json"` | `"text"` | Log output format. |

`"text"` emits human-readable lines (`[extension:foo] INFO: message`).
`"json"` emits newline-delimited JSON objects suitable for Datadog, Loki, ELK, etc.:

```json
{"ts":"2026-01-01T00:00:00.000Z","level":"info","msg":"step completed","extension":"my-ext","data":{}}
```

**Environment variable**: `LOG_FORMAT=json` sets the format at the process level and takes effect when `log.format` is not set in config. Config wins over the env var when both are present.

## Daemon log format

The `log.format` setting above controls agent session and extension log output. The daemon's own operational logs (startup, workflow start/finish, errors) use a separate mechanism:

- `kota daemon start --log-format json` — emit NDJSON to stderr for the current daemon process.
- `KOTA_DAEMON_LOG_FORMAT=json kota daemon start` — equivalent env var form.

Each line has the shape: `{"ts":"…","level":"info|warn|error","msg":"…","workflow":"…","runId":"…"}`.

This is intentionally separate from `log.format`: setting `"log": {"format": "json"}` in config does **not** affect daemon operational output. Use `--log-format` or `KOTA_DAEMON_LOG_FORMAT` for daemon logs.

## Other notable settings

See `src/config.ts` (`KotaConfig` type) for the full list of supported fields and their types. Key areas:

- `model`, `editorModel`, `maxTokens` — model selection
- `guardrails` — risk policy and tool call enforcement
- `extensions` — per-extension config blocks (see below)
- `foreignExtensions` — out-of-process KEMP extensions (see `docs/FOREIGN-EXTENSIONS.md`)
- `daemon.shutdownGracePeriodMs` — graceful shutdown window
- `serve.noAuth` — disable bearer-token auth for `kota serve` (dev only)
- `dailyBudgetUsd` — cap autonomous spend per UTC calendar day
- `runsGc` — run artifact retention policy
- `webhooks` — per-workflow webhook secrets

## Extensions

Extension config lives under the `extensions` key in your config file.
Notification extensions (Telegram, Slack, webhook) are documented in `docs/NOTIFICATIONS.md`.

### GitHub

Provides GitHub REST API tools for use in agent sessions:
`github_create_pr`, `github_get_pr`, `github_list_issues`, `github_list_prs`, `github_comment`,
`github_merge_pr`, `github_close_pr`, `github_create_issue`, `github_update_issue`,
`github_add_label`, `github_remove_label`.

Write tools (`github_create_pr`, `github_comment`, `github_merge_pr`, `github_close_pr`,
`github_create_issue`, `github_update_issue`, `github_add_label`, `github_remove_label`) are
classified as dangerous and require operator approval in autonomous mode.

```json
{
  "extensions": {
    "github": {
      "token": "$GITHUB_TOKEN",
      "repo": "owner/repo"
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `token` | Yes | GitHub PAT or `$ENV_VAR` reference. Never logged. |
| `repo` | No | Default `owner/repo`. Falls back to `git remote get-url origin`. |
| `requireApproval` | No | Tool names requiring explicit approval. Default: all write tools (`github_merge_pr`, `github_close_pr`, `github_create_issue`, `github_update_issue`, `github_add_label`, `github_remove_label`). |

If `token` is missing or the env var is unset, the extension loads but contributes no tools (warning logged).

### GitHub Webhook

Receives GitHub webhook deliveries and emits `github.push`, `github.pull_request`, and
`github.check_run` bus events. Workflows use these as `event:` triggers.

See `docs/GITHUB-WEBHOOK.md` for setup instructions and the full event payload reference.

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
| `events` | No | Event types to forward. Default: `["push", "pull_request", "check_run"]`. |

If `secret` is missing or the env var is unset, the route is not registered (warning logged).
