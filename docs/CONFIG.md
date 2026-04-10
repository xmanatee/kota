# Configuration Reference

## First-time setup

Run `kota init` in a new directory to scaffold the required project structure:
- `kota.config.ts` — project config with commented-out module blocks
- `data/inbox/` — quick captures and rough ideas
- `data/tasks/` — normalized task queue subdirectories (`ready/`, `doing/`, `backlog/`, `blocked/`, `done/`, `dropped/`)
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
| Modules | All configured modules load without error |
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

`"text"` emits human-readable lines (`[module:foo] INFO: message`).
`"json"` emits newline-delimited JSON objects suitable for Datadog, Loki, ELK, etc.:

```json
{"ts":"2026-01-01T00:00:00.000Z","level":"info","msg":"step completed","module":"my-ext","data":{}}
```

**Environment variable**: `LOG_FORMAT=json` sets the format at the process level and takes effect when `log.format` is not set in config. Config wins over the env var when both are present.

## Daemon log format

The `log.format` setting above controls agent session and module log output. The daemon's own operational logs (startup, workflow start/finish, errors) use a separate mechanism:

- `kota daemon start --log-format json` — emit NDJSON to stderr for the current daemon process.
- `KOTA_DAEMON_LOG_FORMAT=json kota daemon start` — equivalent env var form.

Each line has the shape: `{"ts":"…","level":"info|warn|error","msg":"…","workflow":"…","runId":"…"}`.

This is intentionally separate from `log.format`: setting `"log": {"format": "json"}` in config does **not** affect daemon operational output. Use `--log-format` or `KOTA_DAEMON_LOG_FORMAT` for daemon logs.

## Metrics endpoint

The daemon exposes a Prometheus-compatible scrape endpoint at `GET /metrics` on the control port. The port is written to `.kota/daemon-control.json` at startup. See `docs/GRAFANA.md` for scrape configuration, available metrics, and a sample Grafana dashboard.

## Other notable settings

See `src/config.ts` (`KotaConfig` type) for the full list of supported fields and their types. Key areas:

- `model`, `editorModel`, `maxTokens` — model selection
- `guardrails` — risk policy and tool call enforcement
- `modules` — per-module config blocks (see below)
- `foreignModules` — out-of-process KEMP modules (see `docs/FOREIGN-MODULES.md`)
- `daemon.shutdownGracePeriodMs` — graceful shutdown window
- `daemon.sessionIdleTtlMs` — idle TTL for daemon-owned interactive chat sessions (default: 300000, 5 minutes)
- `serve.noAuth` — disable bearer-token auth for `kota serve` (dev only)
- `serve.showCost` — show per-turn cost line in terminal output (default: `true`; set to `false` to suppress, or pass `--no-cost` CLI flag)
- `dailyBudgetUsd` — cap autonomous spend per UTC calendar day
- `budget.warnAt` — soft-limit threshold (0–1 fraction); fires a one-time channel notification before the hard stop
- `runsGc` — run artifact retention policy
- `webhooks` — per-workflow webhook secrets
- `scheduler.dispatchWindow` — restrict idle and interval triggers to specific hours/days (see below)
- `scheduler.agentConcurrency` — maximum agent-step workflows running simultaneously (default: 1)
- `scheduler.codeConcurrency` — maximum code-only workflows running simultaneously (default: 4)
- `notifications.quietHours` — suppress non-critical channel notifications outside specified hours (see below)
- `workflow.maxStepOutputBytes` — cap step output size to prevent large outputs flooding disk and agent context (see below)
- `mcp.sampling.enabled` — allow MCP clients to delegate LLM completions to KOTA (default: `false`; see `docs/MCP.md`)

## Budget

### budget.warnAt

Fires a one-time channel notification (`workflow.budget.warning`) when daily spend crosses a configurable fraction of `dailyBudgetUsd`. The warning resets each UTC day alongside the budget.

```json
{
  "dailyBudgetUsd": 10.0,
  "budget": {
    "warnAt": 0.8
  }
}
```

With this config, a notification fires when daily spend reaches $8.00 (80% of $10.00). The hard stop at $10.00 still applies. Omitting `budget.warnAt` disables soft-limit warnings.

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

### agentConcurrency and codeConcurrency

Control how many workflows may execute simultaneously.

```json
{
  "scheduler": {
    "agentConcurrency": 2,
    "codeConcurrency": 8
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `agentConcurrency` | `1` | Maximum number of agent-step workflows running at once. Raise to allow parallel custom agent workflows. |
| `codeConcurrency` | `4` | Maximum number of code-only (no agent step) workflows running at once. |

Both values must be positive integers. Zero or negative values produce a config warning at startup and fall back to the defaults.

The autonomy workflows are unaffected — each workflow runs independently and the default of 1 already serializes agent dispatch correctly.

Active limits are shown in `kota workflow status` under `Concurrency: agent=N, code=N` when the daemon is running.

## Notifications

### notifications.quietHours

Suppresses non-critical channel notifications (Telegram, Slack, webhook, email) during specified hours and releases them as a single batched digest when the window ends. Workflows and the scheduler continue running normally — only channel delivery is affected.

```json
{
  "notifications": {
    "quietHours": {
      "start": "22:00",
      "end": "08:00",
      "allowCritical": true
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `start` | Yes | Quiet period start in local time, `"HH:MM"` (24-hour). |
| `end` | Yes | Quiet period end in local time, `"HH:MM"` (24-hour). Windows crossing midnight (e.g. `22:00`–`08:00`) are supported. |
| `allowCritical` | No | When `true` (default), `workflow.failure.alert` and `module.crash.alert` bypass quiet hours and are delivered immediately. |

**Events held during quiet hours:** `workflow.attention.digest`, `workflow.budget.exceeded`, `workflow.budget.warning`.

**Batch release:** When quiet hours end, all held events are released as a single `workflow.attention.digest` message (one message per channel, not one per held event). Notifications held at daemon restart are lost — the operator receives a fresh digest at the next window opening.

Times use the daemon's local timezone. When no `quietHours` config is set, behavior is identical to today.

## Modules

### Installing user-defined modules

All user modules live under `.kota/modules/<name>/`. There is one canonical way
to add a module — place it in this directory. Three packaging variants are supported:

| Variant | What to put in `.kota/modules/<name>/` |
|---------|------------------------------------------|
| Single-file code | `index.js` or `index.mjs` — direct ESM export of `KotaModule` |
| Packaged (compiled TS) | `package.json` with `"main"` pointing to the compiled entry |
| JSON manifest | `manifest.json` — declarative tool definitions without code |

Install from npm, GitHub, or a URL with the CLI:

```sh
kota module install kota-weather        # from npm
kota module install github:user/repo    # from GitHub
kota module install https://example.com/ext.mjs  # from URL
```

Installed modules land in `.kota/modules/<name>/` automatically.

Foreign (out-of-process) modules that communicate via the KEMP subprocess protocol
are declared in `foreignModules` in `.kota/config.json`. See `docs/FOREIGN-MODULES.md`.

Module config lives under the `modules` key in your config file.
Notification modules (Telegram, Slack, webhook, email) are documented in `docs/NOTIFICATIONS.md`.

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
  "modules": {
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
| `taskProvider.enabled` | No | Set to `true` to register GitHub Issues as KOTA's task source. Default: disabled. |
| `taskProvider.labelFilter` | No | Label filter applied when listing issues (e.g. `"kota-task"`). Default: no filter. |
| `taskProvider.inProgressLabel` | No | Label added when a task is claimed. Default: `"in-progress"`. |
| `taskProvider.doneLabel` | No | Label added when a task is completed. Default: `"kota-done"`. Issue is also closed. |
| `taskProvider.priorityLabels` | No | Maps KOTA priority values (`"high"`, `"medium"`, `"low"`) to GitHub label names. |

When `taskProvider.enabled` is `true`, the GitHub module registers as a `TaskProvider`. Issues
matching the label filter are fetched at startup and cached in memory. Claiming a task adds the
`inProgressLabel`; completing a task closes the issue and adds the `doneLabel`. The GitHub token
must have `issues:write` scope for mutations.

```json
{
  "modules": {
    "github": {
      "token": "$GITHUB_TOKEN",
      "repo": "owner/repo",
      "taskProvider": {
        "enabled": true,
        "labelFilter": "kota-task",
        "priorityLabels": { "high": "priority:high", "medium": "priority:medium", "low": "priority:low" }
      }
    }
  }
}
```

If `token` is missing or the env var is unset, the module loads but contributes no tools (warning logged).

### Linear

Optional module — not loaded by default. Provides a `TaskProvider` backed by Linear Issues so
KOTA's builder can pull tasks directly from a Linear team without maintaining a parallel file queue.
No npm dependencies; uses Linear's GraphQL API directly.

```json
{
  "modules": {
    "linear": {
      "apiKey": "$LINEAR_API_KEY",
      "taskProvider": {
        "enabled": true,
        "teamKey": "ENG",
        "labelFilter": "kota-task",
        "inProgressState": "In Progress",
        "doneState": "Done"
      }
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `apiKey` | Yes | Linear API key or `$ENV_VAR` reference. Never logged. |
| `taskProvider.enabled` | No | Set to `true` to register Linear Issues as KOTA's task source. Default: disabled. |
| `taskProvider.teamKey` | Yes (when enabled) | Linear team key (e.g. `"ENG"`). |
| `taskProvider.labelFilter` | No | Only include issues with this label. Default: no filter. |
| `taskProvider.inProgressState` | No | Workflow state name to set when a task is claimed. Default: `"In Progress"`. |
| `taskProvider.doneState` | No | Workflow state name to set when a task is completed. Default: `"Done"`. A comment is also added. |

When `taskProvider.enabled` is `true`, the module fetches the team's open issues at startup and
caches them in memory. Claiming a task transitions the issue to `inProgressState`; completing it
transitions to `doneState` and adds a comment. State names must match exactly the workflow state
names in your Linear workspace. If `apiKey` is missing or the env var is unset, the provider is
inactive (warning logged).

### Jira

Optional module — not loaded by default. Provides a `TaskProvider` backed by Jira Cloud issues so
KOTA's builder can pull tasks directly from a Jira project without maintaining a parallel file queue.
No npm dependencies; uses Jira REST API v3 with Basic auth. Cloud only (`.atlassian.net`).

```json
{
  "modules": {
    "jira": {
      "apiToken": "$JIRA_API_TOKEN",
      "userEmail": "$JIRA_USER_EMAIL",
      "baseUrl": "$JIRA_BASE_URL",
      "taskProvider": {
        "enabled": true,
        "projectKey": "ENG",
        "jqlFilter": "assignee = currentUser()",
        "inProgressTransition": "In Progress",
        "doneTransition": "Done",
        "claimOnStart": true
      }
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `apiToken` | Yes | Jira API token or `$ENV_VAR` reference. Never logged. |
| `userEmail` | Yes | Jira account email or `$ENV_VAR` reference. Never logged. |
| `baseUrl` | Yes | Jira Cloud base URL (e.g. `"https://myorg.atlassian.net"`) or `$ENV_VAR`. |
| `taskProvider.enabled` | No | Set to `true` to register Jira Cloud as KOTA's task source. Default: disabled. |
| `taskProvider.projectKey` | Yes (when enabled) | Jira project key (e.g. `"ENG"`). |
| `taskProvider.jqlFilter` | No | Extra JQL appended to the base query. Default: no extra filter. |
| `taskProvider.inProgressTransition` | No | Transition name to apply when a task is claimed. Default: `"In Progress"`. |
| `taskProvider.doneTransition` | No | Transition name to apply when a task is completed. Default: `"Done"`. |
| `taskProvider.claimOnStart` | No | Assign the issue to the authenticated user when claimed. Default: `true`. |

When `taskProvider.enabled` is `true`, the module fetches open issues from `projectKey` at startup
and caches them in memory. Transition IDs are looked up by name at init and cached. Claiming a task
applies `inProgressTransition` and optionally assigns the issue to the authenticated user;
completing it applies `doneTransition`. Transition names must match exactly the workflow transition
names in your Jira project. If any credential is missing or unset, the provider is inactive
(warning logged).

### GitHub Webhook

Receives GitHub webhook deliveries and emits `github.push`, `github.pull_request`, and
`github.check_run` bus events. Workflows use these as `event:` triggers.

See `docs/GITHUB-WEBHOOK.md` for setup instructions and the full event payload reference.

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

| Field | Required | Description |
|-------|----------|-------------|
| `secret` | Yes | Webhook secret or `$ENV_VAR` reference. Never logged. |
| `events` | No | Event types to forward. Default: `["push", "pull_request", "check_run"]`. |

If `secret` is missing or the env var is unset, the route is not registered (warning logged).

### Filesystem

Built-in module — always loaded. Provides `file_read`, `file_write`, `file_edit`, `multi_edit`, `find_replace`, `glob`, `grep`, `file_watch`, and `files_overview` tools.

Read-only tools (`file_read`, `glob`, `grep`, `files_overview`) are classified safe in guardrails. Write tools (`file_write`, `file_edit`, `multi_edit`, `find_replace`) are moderate risk. `file_watch` runs background watchers and is moderate risk.

No config file keys are required.

### Google Workspace

Optional module — not loaded by default. Provides Gmail, Calendar, and Drive tools for agents in the `productivity` tool group: `gmail_list_messages`, `gmail_get_message`, `gmail_send`, `calendar_list_events`, `calendar_create_event`, `drive_list_files`, and `drive_read_file`. Uses OAuth 2.0 refresh token auth with in-process token caching. No npm dependencies beyond Node 18+.

```json
{
  "modules": {
    "google-workspace": {
      "clientId": "$GOOGLE_CLIENT_ID",
      "clientSecret": "$GOOGLE_CLIENT_SECRET",
      "refreshToken": "$GOOGLE_REFRESH_TOKEN",
      "userId": "me",
      "calendarId": "primary"
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `clientId` | Yes | OAuth 2.0 client ID or `$ENV_VAR` reference. Never logged. |
| `clientSecret` | Yes | OAuth 2.0 client secret or `$ENV_VAR` reference. Never logged. |
| `refreshToken` | Yes | OAuth 2.0 refresh token or `$ENV_VAR` reference. Never logged. |
| `userId` | No | Gmail/Calendar user ID. Default: `"me"`. |
| `calendarId` | No | Google Calendar ID. Default: `"primary"`. |

Required OAuth scopes: `gmail.modify`, `calendar`, `drive.readonly`. See `src/modules/google-workspace/AGENTS.md` for full setup instructions. `gmail_send` and `calendar_create_event` are classified as dangerous tools and require operator approval in autonomous mode. If any required credential is missing, the module loads but contributes no tools (warning logged).

### Web Access

Built-in module — always loaded. Provides `web_fetch`, `web_search`, and `http_request` tools.

`web_search` uses DuckDuckGo by default. Set `BRAVE_SEARCH_API_KEY` in the environment to use the Brave Search API instead (higher quality results, rate-limited by plan).

No config file keys are required.
