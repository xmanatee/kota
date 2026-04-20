---
id: task-add-cli-error-message-hints
title: Add hint suffixes to kota CLI error messages
status: backlog
priority: p3
area: cli
summary: Error messages from kota CLI should include a one-line hint about the most likely next step so operators can recover without reading source.
created_at: 2026-04-15T00:00:00.000Z
updated_at: 2026-04-15T00:00:00.000Z
---

## Problem

kota CLI surfaces failures but does not point at likely next steps.
Operators who are not already deep in the source have to read code or
grep docs to figure out a recovery path, which slows diagnosis for
simple, common errors.

## Desired Outcome

- Every kota CLI error message carries a one-line hint suffix naming
  the most likely next step (doc pointer, config key, or command).
- The hints are table-driven so adding a new error type does not
  require editing scattered format strings.

## Constraints

- Hints must come from a single source-of-truth table keyed by error
  code; no inline hint strings sprinkled through call sites.
- Do not change error exit codes or machine-readable output.

## Done When

- Every existing CLI error call site routes through the hint table.
- A new error type added via the table surfaces its hint without code
  changes to call sites.
- CLI snapshot tests cover at least three representative errors with
  their hints.
