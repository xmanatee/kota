# Extensions

This directory contains built-in extensions and extension-level wiring.

- Keep built-in extensions isolated behind extension contracts rather than reaching into core internals ad hoc.
- If extension boundaries drift, fix the boundary instead of normalizing the drift.
- Prefer real ownership over thin wrappers. If an extension owns multiple tools,
  routes, commands, skills, or tests, give it a dedicated directory and keep
  the capability implementation close to the extension instead of scattering it
  back into shared core buckets.
- All extensions follow the per-directory pattern: `<name>/index.ts` as the
  entry point, with co-located tests and helpers. Do not add new flat `.ts` extension
  files at the top level of this directory.
- When adding a new extension directory, add an entry for it in the **Built-in Extensions** list below.

## Shared Utilities

- `notify-retry.ts` — `postWithRetry`: shared HTTP POST helper with exponential-backoff retry used by the webhook and Slack extensions. Accepts `retries` and `baseDelayMs` options; logs a warning after all attempts are exhausted.

## Built-in Extensions

- `daemon/index.ts` — `kota daemon` CLI command (with `status`, `pid`, `stop`, and `reload` subcommands), supervisor/child startup path, and built-in workflow/channel resolution passed into `scheduler/daemon.ts`.
- `web/index.ts` — `kota serve` CLI command; starts the HTTP API/web UI server and injects extension routes discovered from the loader.
- `history/index.ts` — `conversation_recall` management tool and matching history skill. Tool implementation in `history/conversation-recall.ts`.
- `memory/index.ts` — `memory` management tool and matching memory skill. Tool implementation in `memory/memory.ts`.
- `knowledge/index.ts` — `knowledge` management tool and matching knowledge skill. Tool schema in `knowledge/knowledge-schema.ts`, runner in `knowledge/knowledge.ts`.
- `working-memory/index.ts` — session-scoped scratchpad tools plus prompt injection of named working-memory entries.
- `sqlite-memory/index.ts` — alternative SQLite-backed memory provider selected through `providers.memory`.
- `scheduler/index.ts` — `schedule` management tool and matching scheduler skill.
- `secrets/index.ts` — `kota secrets` CLI commands plus the `get_secret` tool that injects secret values into process env without exposing them to the LLM.
- `tool-cache/index.ts` — cache middleware for deterministic read tools; registers/unregisters middleware on extension load/unload. Implementation in `tool-cache/cache.ts`.
- `tool-retry/index.ts` — retry middleware for transient tool failures plus retry skill guidance.
- `registry/index.ts` — `kota tools` CLI surface for installing, updating, listing, and removing external tool packages.
- `webhook/index.ts` — HTTP notification extension. POSTs a JSON payload to one or more configured URLs on each notification event. Subscribes to `approval.requested` unconditionally (bypasses the `events` filter); all other notification events are filtered by the optional `events` array. Uses `postWithRetry` for delivery. No tools, channels, or CLI commands.
- `slack/index.ts` — Slack notification extension. POSTs Block Kit messages to a configured Incoming Webhook URL. Same event subscription pattern as `webhook/index.ts`: `approval.requested` always forwarded, others filtered by optional `events` array. Subscribes to five default notification events including `workflow.cost.anomaly`; `workflow.build.committed` is opt-in (not in the default set, must be listed in config `events`). No OAuth app or bot token required.
- `slack-channel/index.ts` — Bidirectional Slack bot channel using Socket Mode (WebSocket). Contributes `slack-channel` ChannelDef: routes DMs to per-user AgentSessions, posts Block Kit Approve/Reject buttons on `approval.requested`, resolves approvals in-process via button clicks. Config: `extensions.slackChannel.{botToken, appToken, notifyChannel}`. No public HTTP endpoint required. Separate from the one-way `slack/` webhook extension.
- `telegram/index.ts` — Telegram interactive extension. Contributes: `kota telegram` CLI command (interactive bot), `telegram-status` channel (daemon status poll responding to `/status`), and notification subscriptions for all workflow events including `approval.requested`. Supports opt-in events (e.g. `workflow.build.committed`) via `events` array in extension config.
- `github/index.ts` — GitHub REST API tools: `github_create_pr`, `github_get_pr`, `github_list_issues`, `github_list_prs`, `github_comment`, `github_merge_pr`, `github_close_pr`, `github_create_issue`, `github_update_issue`, `github_add_label`, `github_remove_label`. Requires `extensions.github.token`. Write tools (`github_merge_pr`, `github_close_pr`, `github_create_issue`, `github_update_issue`, `github_add_label`, `github_remove_label`) are classified as dangerous in guardrails. Supports `$ENV_VAR` token references and falls back to `git remote` for repo resolution.
- `github-webhook/index.ts` — GitHub webhook receiver. Registers `POST /api/webhooks/github`, validates `X-Hub-Signature-256` HMAC using `node:crypto`, and emits `github.push`, `github.pull_request`, or `github.check_run` bus events. Requires `extensions.github-webhook.secret`. Route is not registered when secret is missing.
- `execution/index.ts` — Execution capability pack: `shell` (run shell commands), `process` (manage background processes), `code_exec` (Python/Node.js REPL), `computer_use` (GUI automation), `screenshot` (screen capture). High-risk surface; shell/process/code_exec can execute arbitrary code. Tools, helpers, and tests live together under the extension directory.
- `filesystem/index.ts` — Filesystem capability pack: `file_read`, `file_write`, `file_edit`, `multi_edit`, `find_replace`, `glob`, `grep`, `file_watch`, `files_overview`, `repo_map`. Read-only tools are safe; write tools are moderate risk. Tools, helpers, and tests live together under the extension directory.
- `git/index.ts` — Git capability pack: `git` tool with status, diff, log, show, add, commit, branch, and push operations. Force-push to main/master is blocked; protected-branch deletion is blocked; large diffs are auto-truncated. Tools and tests live together under the extension directory.
- `notebook/index.ts` — Notebook capability pack: `notebook` tool for creating and extending Jupyter notebooks (.ipynb) with code and markdown cells. Supports python3 and javascript kernels. Tools and tests live together under the extension directory.
- `read-document/index.ts` — Read document capability pack: `read_document` tool for extracting plain text from PDF, DOCX, RTF, ODT, EPUB, and HTML files using system tools (pdftotext, textutil, pandoc). Zero npm dependencies. Tools, helpers, and tests live together under the extension directory.
- `system/index.ts` — System capability pack: `clipboard` (read/write system clipboard), `view_image` (load local images for visual analysis), `env_info` (discover host OS, runtimes, services, and resources), `sqlite` (query SQLite databases), `notify` (send desktop notifications). Tools, helpers, and tests live together under the extension directory.
- `web-access/index.ts` — Web access capability pack: `web_fetch` (fetch URLs as Markdown), `web_search` (DuckDuckGo/Brave search), and `http_request` (arbitrary HTTP requests). All in the "web" tool group. This is the reference implementation of the extension-owned capability pattern — tools, helpers, and tests live together under the extension directory rather than in `src/tools/`.
- `mcp-server/index.ts` — `kota mcp-server` CLI command; starts a stdio MCP server exposing KOTA tools to MCP-compatible hosts. Passes `samplingEnabled` and a `ModelClient` to `McpServer` when `mcp.sampling.enabled` is true in config. Supports `--tools` filter and `--name` override.
- `vercel-adapter/index.ts` — Vercel AI SDK Data Stream Protocol adapter; contributes `POST /api/chat/vercel` for stateless Vercel `useChat` clients.
