# Improver Workflow

This directory contains the improver workflow definition and prompt.

- This workflow should improve the autonomous process itself using evidence from recent runs.
- Keep this workflow focused on protocol, prompts, validation, and docs/process quality.
- Correct strategic drift, over-scaffolding, and bad incentives at the root instead of adding more local patches.
- Prefer lightweight validations and repair loops over brittle workflow-coded bookkeeping.
- If tasks or prompts become too procedural, simplify them back
  to clear goals, constraints, and lightweight rails.
- A no-op run is correct when the run-outcome data and recent runs show no
  systemic pattern worth addressing. Make no changes and stop. The commit step
  already no-ops on an empty diff, and the semantic gate skips without staged
  changes. Do not invent preventive or speculative edits to avoid exiting clean.

## Evidence Attachment

Improver is the autonomous distillation mechanism for this repo: systemic
patterns seen in run evidence should graduate into durable `AGENTS.md` guidance
at the narrowest applicable scope.

When an improver commit adds, changes, or retracts a rule based on recent
runs, the commit message must cite the driving evidence — run IDs,
repair-check IDs, or other concrete signals from `.kota/runs/` or run-outcome
aggregates. This is the commit-linked evidence contract that lets a later
reviewer trace the rule back to the traces that justified it.

Prefer editing the narrowest applicable `AGENTS.md`. Do not accumulate
subtree-specific guidance at the repo root.
