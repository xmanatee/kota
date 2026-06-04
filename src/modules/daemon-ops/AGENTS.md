# Daemon Ops Module

This directory owns the `daemon-ops` repo module — the operator-facing CLI and
supervisor surface around the daemon runtime. It also owns the daemon-facing
CLI commands.

- Keep this module focused on operator control: daemon status, lifecycle,
  service installation, live event inspection, session inspection, and a
  concise operational snapshot.
- Service integration should stay user-level and directory-scoped. Do not
  require elevated privileges or create global machine state.
- Exact command names, flags, output fields, service-unit contents, and restart
  constants belong in the command implementation and tests, not docs catalogs.
- The daemon runtime itself lives in core; this module wires it into the CLI and
  supervisor surface.
- Session autonomy mode is part of that operator surface. This module owns the
  `kota session` CLI plus the `sessions` `KotaClient` namespace
  (`client.sessions.list()` / `client.sessions.setAutonomyMode()`) end-to-end.
  Both the local-side handler (`sessionsLocalClient`) and the daemon-side
  handler (`buildSessionsDaemonHandler` in `index.ts`, contributed through the
  `daemonClient(link)` factory) realize the contract declared in `client.ts`.
  Validate mode values before issuing the HTTP call. Do not embed mode-change
  flow into any other subcommand (e.g. approval resolution) — mode is a
  session-level control.
- The `daemonOps` `KotaClient` namespace (`client.daemonOps.status()`,
  `pid()`, `stop()`, `reload()`) is also owned end-to-end by this module.
  The local handler (`localClient` in `index.ts` backed by
  `daemon-ops-operations.ts`) reads `.kota/daemon-control.json` to
  distinguish "not running" from "stale control file"; the daemon-side
  handler (`buildDaemonOpsDaemonHandler` in `index.ts`, contributed through
  the same `daemonClient(link)` factory alongside `sessions`) routes
  `status()`/`pid()` through `GET /status` and `reload()` through
  `POST /reload`. `stop()` always throws on the daemon-up branch — the
  daemon cannot SIGTERM itself, so the local handler is the only one that
  performs the actual stop. The non-namespace direct methods
  `DaemonControlClient.getDaemonStatus()` and `reloadConfig()` continue to
  consume the helpers in `src/core/server/daemon-client.ts` because they
  bridge `kota serve` ⇄ daemon and are not part of the namespace contract.

## Directory-Scope Compatibility

Scope is the core abstraction. The `kota project` operator command and
`?projectId=` flags are compatibility language for directory-backed scopes,
and every operator command consumes that compatibility adapter through the
same paths. Do not reinvent selection per command.

- Reads come through `client.projects.list()`. The daemon's `/projects`
  route returns the registry projection plus the operator-selected
  `activeProjectId` (or `null` when no selection is in force) in a single
  round trip. Other CLIs that need to render a project selector consume
  this same shape; do not call `getProjectRegistryProjection()` and
  `/projects/active` separately just to splice them client-side.
- Writes come through `client.projects.use(id | null)`. The daemon
  persists the selection in-memory only — restarting the daemon clears
  the selection back to the registry default — and routes that take
  `?projectId=` use the active selection when the parameter is omitted.
  `kota project use` is the canonical entry point; `null` clears the
  selection, an unknown id surfaces `not_found`.
- Per-command `--project <id>` flags override the active selection for
  one call. `daemon-ops` subcommands (`status`, `session`, `events`)
  pass the flag through as `?projectId=<id>` and otherwise leave the
  query parameter unset so the daemon resolves to the active selection.
  Cross-project operations are an explicit opt-in (e.g.
  `events tail --all-projects`) — never the default. New operator
  surfaces should follow the same shape rather than introducing a
  parallel "all projects" or per-project flag set.
- Single-project setups never render a selector. The presence threshold
  in `daemon-ops` views (e.g. the `Active project` line in `kota
  status`) is "registry hosts more than one project," so KOTA-on-itself
  remains a one-line experience.

## Presentation Boundaries

- The dashboard owns visual layout. The daemon core must not draw decorative
  rules, frames, or aligned columns in its log output. Anything emitted via
  `DaemonLogger` shows up inside the dashboard's activity section, so a
  `────` rule from core would render as a second nested frame.
- The daemon core emits a single concise readiness line on startup
  (`Daemon ready (pid …): N workflows, M scheduled items, poll Xs`).
  Static counts already in the dashboard snapshot (workflow count, pid,
  uptime) belong in the snapshot, not in repeated startup log lines.
- Stat grids must compute column widths from the widest entry in each column
  with at least two spaces of gap between value and the next label. Fixed
  `padEnd(N)` is forbidden for stat values, since cost/count growth silently
  collides values with the next label.
- Status block and streaming activity must be visibly separated. The dashboard
  draws a single `Activity ─────` heading rule before the captured log buffer;
  the static block above it has no horizontal rules of its own. The rule uses
  the rendering module's `sectionRule` primitive so it fills the terminal
  width instead of clipping to a fixed column count.
- The live dashboard enters the terminal's alternate-screen buffer on a TTY.
  Refreshes overwrite a private buffer instead of scrolling the primary
  buffer, so a daemon-long session cannot accumulate duplicated status frames
  in scrollback. Non-TTY contexts skip this and keep normal line output.
- The `Work` section only renders when the task queue carries actionable
  signal. Zero-valued states (`Doing 0`, `Backlog 0`, etc.) are filtered out
  of the counts row and a fully-zero queue suppresses the section entirely,
  so the heading never introduces a row that looks blank.

## Peer CLI Reference

A short, decision-focused comparison of how peer CLIs present daemon-style
state. Used to inform layout choices here, not to mirror them.

- `k9s` and `lazygit` use full-screen panes with persistent focus areas. KOTA
  intentionally does not adopt that model: the dashboard renders into a
  single scrolling region so daemon-mode log capture and interactive mode
  share the same presentation pipeline.
- `htop` separates static metrics (header) from streaming process rows with
  a clear visual break. KOTA mirrors this with a static stat grid above and
  an `Activity ─────` separator before the captured log buffer.
- Claude Code, Codex CLI, `gemini-cli`, and Antigravity CLI favor minimal chrome: a header
  line with identity and a streaming body. KOTA adopts the same restraint:
  one header line (`KOTA Daemon  pid …  up …  status`) with no surrounding
  box, then a compact stat grid, then activity. No nested frames.
- `pi-mono`'s terminal UI splits status from activity with a labeled rule
  rather than a continuous border; KOTA uses the same pattern.
- Color is reserved for state changes (running/stopping/stopped, paused yes,
  active-run dot). Counts and labels stay plain so width math is reliable
  and non-TTY fallback degrades cleanly.
