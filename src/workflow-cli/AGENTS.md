# Workflow CLI

This directory contains the per-subcommand modules for `kota workflow`.

- `run-list.ts` — `kota workflow list` and related listing commands.
- `run-show.ts` — `kota workflow show <runId>` step-level display.
- `logs.ts` — `kota workflow logs` log streaming.
- `trigger.ts` — `kota workflow trigger` and manual-trigger commands.
- `control.ts` — `kota workflow abort`, `pause`, `resume`, `reload`, and `status`.
- `utils.ts` — shared formatting helpers (dates, durations, status icons).

Each file registers its commands onto the parent `workflow` commander. Keep subcommand logic co-located with its file; do not add shared state across subcommands.
