# Configuration Reference

## First-time setup

Run `kota init` in a new directory to scaffold the required project structure:
- `kota.config.ts` — project config with commented-out extension blocks
- `tasks/` — task queue subdirectories (`inbox/`, `ready/`, `doing/`, `backlog/`, `blocked/`, `done/`, `dropped/`)
- `docs/` — documentation directory
- `.kota/` — runtime state directory

`kota init` is idempotent: running it again skips existing files. Pass `--force` to overwrite `kota.config.ts` only. After scaffolding, run `kota doctor` to verify the setup.

## Health checks (kota doctor)

`kota doctor` runs a suite of checks and prints a pass/warn/fail summary:

| Check | What it verifies |
|-------|-----------------|
| Daemon | Daemon process is running and API is reachable |
| Config: global | `~/.kota/config.json` is valid JSON |
| Config: project | `.kota/config.json` is valid JSON |
| Extensions | All configured extensions load without error |
| Providers | Provider configuration is present |
| Provider connectivity | A live 1-token completion reaches the configured model provider |
| Workflows | Built-in workflow definitions are valid |
| Disk | `.kota/` directory exists and is writable |

**Flags:**

| Flag | Description |
|------|-------------|
| `--fix` | Apply safe automatic repairs: remove stale daemon lock file, create missing `.kota/` directories |
| `--json` | Output results as JSON (check array; with `--fix`, `{ checks, repairs }` object) |
| `--skip-connectivity` | Skip the live provider API probe — use in offline environments or CI |

Exit code is 1 if any check fails.

## Config files

KOTA loads config from two JSON files merged in order (project overrides global):

- Global: `~/.kota/config.json`
- Project: `.kota/config.json` (gitignored; use for secrets and project-local overrides)

CLI flags take highest precedence over both files.

## IDE validation and autocompletion

A JSON Schema for `.kota/config.json` is published at `schema/kota-config.schema.json` in the package root. Wire it to your editor for inline validation and documentation-on-hover:

```json
// .vscode/settings.json
{
  "json.schemas": [
    {
      "fileMatch": [".kota/config.json"],
      "url": "${workspaceFolder}/schema/kota-config.schema.json"
    }
  ]
}
```

Run `kota config schema` to print the absolute path to the schema file. Pass `--print` to output the schema content directly.

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
- `serve.showCost` — show per-turn cost line in terminal output (default: `true`; set to `false` to suppress, or pass `--no-cost` CLI flag)
- `dailyBudgetUsd` — cap autonomous spend per UTC calendar day
- `runsGc` — run artifact retention policy
- `webhooks` — per-workflow webhook secrets
- `scheduler.dispatchWindow` — restrict idle and interval triggers to specific hours/days (see below)
- `workflow.maxStepOutputBytes` — cap step output size to prevent large outputs flooding disk and agent context (see below)
- `mcp.sampling.enabled` — allow MCP clients to delegate LLM completions to KOTA (default: `false`; see `docs/MCP.md`)

## Workflow

### maxStepOutputBytes

Caps the size of step outputs written to the run artifact store and injected into agent context. When a step output exceeds the limit, it is replaced with a structured truncation notice and a warning is added to the run (surfacing `completed-with-warnings` status).

```json
{
  "workflow": {
    "maxStepOutputBytes": 131072
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `maxStepOutputBytes` | `262144` (256 KB) | Maximum output size in bytes. Hard cap of `10485760` (10 MB) applies regardless of this value. |

The truncation notice has the shape: `{ "truncated": true, "originalBytes": N, "message": "..." }`. Agent steps that receive a truncated prior-step output see this notice rather than raw bytes, giving the LLM explicit context that output was cut.

Applies to agent, code, trigger, and tool steps. Approval step outputs are exempt.

## Scheduler

### dispatchWindow

Restricts `runtime.idle` (idle triggers) and `intervalMs` (interval triggers) to a time-of-day window. Cron, event, file-watch, and manual triggers are not affected.

```json
{
  "scheduler": {
    "dispatchWindow": {
      "start": "09:00",
      "end": "18:00",
      "days": ["mon", "tue", "wed", "thu", "fri"]
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `start` | Yes | Window open time in local time, `"HH:MM"` (24-hour). |
| `end` | Yes | Window close time in local time, `"HH:MM"` (24-hour, exclusive). Must be later than `start`. |
| `days` | No | Days the window applies. Array of `"mon"`, `"tue"`, `"wed"`, `"thu"`, `"fri"`, `"sat"`, `"sun"`. Default: all days. |

When the window is not set, all triggers dispatch as usual (current behavior is unchanged).

When a trigger fires outside the window, it is deferred: idle events are silently skipped until the next poll cycle that falls inside the window; interval triggers reschedule themselves to fire at the next window opening. Already-running workflow steps are never interrupted.

Times use the daemon's local timezone. IANA timezone configuration is not supported in this field.

When dispatch is blocked by the window, `GET /workflow/status` includes `dispatchWindowBlocked: true`
and `dispatchWindowOpensAt` (ISO timestamp of when the window next opens). `kota workflow status`
prints `Dispatch: blocked by window (opens Mon 09:00)` and the web UI shows a badge next to the
Pause/Resume button.

## Extensions

### Installing user-defined extensions

All user extensions live under `.kota/extensions/<name>/`. There is one canonical way
to add an extension — place it in this directory. Three packaging variants are supported:

| Variant | What to put in `.kota/extensions/<name>/` |
|---------|------------------------------------------|
| Single-file code | `index.js` or `index.mjs` — direct ESM export of `KotaExtension` |
| Packaged (compiled TS) | `package.json` with `"main"` pointing to the compiled entry |
| JSON manifest | `manifest.json` — declarative tool definitions without code |

Install from npm, GitHub, or a URL with the CLI:

```sh
kota extension install kota-weather        # from npm
kota extension install github:user/repo    # from GitHub
kota extension install https://example.com/ext.mjs  # from URL
```

Installed extensions land in `.kota/extensions/<name>/` automatically.

Foreign (out-of-process) extensions that communicate via the KEMP subprocess protocol
are declared in `foreignExtensions` in `.kota/config.json`. See `docs/FOREIGN-EXTENSIONS.md`.

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

### Web Access

Built-in extension — always loaded. Provides `web_fetch`, `web_search`, and `http_request` tools.

`web_search` uses DuckDuckGo by default. Set `BRAVE_SEARCH_API_KEY` in the environment to use the Brave Search API instead (higher quality results, rate-limited by plan).

No config file keys are required.
