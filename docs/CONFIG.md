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

## Other notable settings

See `src/config.ts` (`KotaConfig` type) for the full list of supported fields and their types. Key areas:

- `model`, `editorModel`, `maxTokens` — model selection
- `guardrails` — risk policy and tool call enforcement
- `extensions` — per-extension config blocks
- `foreignExtensions` — out-of-process KEMP extensions (see `docs/FOREIGN-EXTENSIONS.md`)
- `daemon.shutdownGracePeriodMs` — graceful shutdown window
- `serve.noAuth` — disable bearer-token auth for `kota serve` (dev only)
- `dailyBudgetUsd` — cap autonomous spend per UTC calendar day
- `runsGc` — run artifact retention policy
- `webhooks` — per-workflow webhook secrets
