---
id: task-workflow-run-export
title: Add kota workflow export command to dump run data as JSON or CSV
status: ready
priority: p3
area: cli
summary: Run data lives in .kota/runs/ as individual JSON files. Operators who want to analyze cost trends, error patterns, or step timing across many runs must parse raw files manually. A kota workflow export command would produce a structured, consumable dump.
created_at: 2026-03-31T06:42:08Z
updated_at: 2026-03-31T07:15:00Z
---

## Problem

`kota workflow list`, `kota workflow show`, and `kota workflow stats` provide run-level
views but all operate on terminal output. Operators who want to do custom analysis —
compare error rates across workflow types, correlate step duration with model cost, build
a spreadsheet from recent build results — must read `.kota/runs/` directly and parse the
JSON structures by hand.

There is no supported export path that produces a flat, machine-readable summary of
multiple runs in one command.

## Desired Outcome

A `kota workflow export` command that:
- Accepts optional `--workflow <name>`, `--status <status>`, `--since <date>`, and
  `--last <N>` filters matching the existing `kota workflow list` flags.
- Outputs a JSON array (default) or CSV (`--format csv`) of run summaries: run ID,
  workflow name, status, trigger, start time, duration, step count, total cost.
- Writes to stdout by default; accepts `--output <file>` to write to a file.
- Reads run store artifacts directly (no daemon required).

## Constraints

- Reuse `WorkflowRunStore` and the existing run summary types — no new persistence format.
- CSV output must have a stable column order and header row.
- No new runtime dependencies; use Node.js built-ins for CSV serialization.
- Do not include full step logs or message history in the export (keep it a flat summary).

## Done When

- `kota workflow export` outputs a JSON array of run summaries.
- `--format csv` outputs a CSV with a stable header row.
- `--output <file>` writes to the specified path.
- `--workflow`, `--status`, `--since`, and `--last` filters work correctly.
- At least one unit test covers JSON output and one covers CSV output.
