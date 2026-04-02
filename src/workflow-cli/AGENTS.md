# Workflow CLI

This directory contains the per-subcommand modules for `kota workflow`.

- `run-list.ts` — `kota workflow list`, `kota workflow history`, and related listing commands.
- `definitions.ts` — `kota workflow definitions`; lists all loaded definitions or shows full detail for one via `--name`. Supports `--json`. Shows an Inputs section listing field names, types, required/optional status, and descriptions when a workflow declares `inputSchema`.
- `definition-log.ts` — `kota workflow definition-log <workflow-name>`; shows git commit history for a workflow's definition file. Supports `--diff` to show the file diff per commit. Fails gracefully if the file is not git-tracked.
- `run-cost.ts` — `kota workflow cost`; daily cost breakdown by workflow with `--days`, `--workflow`, `--runs`, and `--json` options.
- `run-stats.ts` — `kota workflow stats`; aggregate health table (runs, success/failure counts, avg duration, total cost) with `--days`, `--workflow`, and `--json` options.
- `run-export.ts` — `kota workflow export`; exports run summaries as JSON array (default) or CSV with `--workflow`, `--status`, `--since`, `--last`, `--format`, and `--output` options.
- `run-show.ts` — `kota workflow show <runId>` step-level display.
- `step-inspect.ts` — `kota workflow step-inspect <run-id> <step-id>` prints full step output as JSON (default) or `--format summary`.
- `run-diff.ts` — `kota workflow diff <run-id-a> <run-id-b>` step-level comparison table; exports `buildRunDiff` and `formatRunDiff` for testing.
- `logs.ts` — `kota workflow logs` log streaming.
- `follow.ts` — `kota workflow follow [run-id]` live run output streaming with SSE and file-poll fallback.
- `trigger.ts` — `kota workflow trigger` and manual-trigger commands.
- `run.ts` — `kota workflow run --dry-run` command registration.
- `dry-run.ts` — `buildDryRunPlan` and `formatDryRunPlan`; evaluates `when` predicates against empty context and prints the step execution plan.
- `control.ts` — `kota workflow abort`, `pause`, `resume`, `reload`, and `status`.
- `gc.ts` — `kota workflow gc`; prunes old run artifact directories under `.kota/runs/` using the retention policy from config (`runsGc`) or CLI flags.
- `utils.ts` — shared formatting helpers (dates, durations, status icons).

Each file registers its commands onto the parent `workflow` commander. Keep subcommand logic co-located with its file; do not add shared state across subcommands.
