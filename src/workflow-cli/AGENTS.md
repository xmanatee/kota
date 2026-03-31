# Workflow CLI

This directory contains the per-subcommand modules for `kota workflow`.

- `run-list.ts` — `kota workflow list`, `kota workflow history`, and related listing commands.
- `definitions.ts` — `kota workflow definitions`; lists all loaded definitions or shows full detail for one via `--name`. Supports `--json`.
- `run-cost.ts` — `kota workflow cost`; daily cost breakdown by workflow with `--days`, `--workflow`, `--runs`, and `--json` options.
- `run-stats.ts` — `kota workflow stats`; aggregate health table (runs, success/failure counts, avg duration, total cost) with `--days`, `--workflow`, and `--json` options.
- `run-show.ts` — `kota workflow show <runId>` step-level display.
- `logs.ts` — `kota workflow logs` log streaming.
- `follow.ts` — `kota workflow follow [run-id]` live run output streaming with SSE and file-poll fallback.
- `trigger.ts` — `kota workflow trigger` and manual-trigger commands.
- `run.ts` — `kota workflow run --dry-run` command registration.
- `dry-run.ts` — `buildDryRunPlan` and `formatDryRunPlan`; evaluates `when` predicates against empty context and prints the step execution plan.
- `control.ts` — `kota workflow abort`, `pause`, `resume`, `reload`, and `status`.
- `gc.ts` — `kota workflow gc`; prunes old run artifact directories under `.kota/runs/` using the retention policy from config (`runsGc`) or CLI flags.
- `utils.ts` — shared formatting helpers (dates, durations, status icons).

Each file registers its commands onto the parent `workflow` commander. Keep subcommand logic co-located with its file; do not add shared state across subcommands.
