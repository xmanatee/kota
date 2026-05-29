# builder-skill-injection-ablation

This fixture is a compact skill-ablation smoke test. It does not import
SWE-Skills-Bench data or scripts; it mirrors only the paired evaluation
shape on a fixture-native software task.

The initial project has one ready task asking an agent to normalize
`data/tickets/T-1042.json` into `output/ticket-summary.json` and move the
task to `done/`. Three fixture-local workflows run the same prompt and
same initial tree:

- `skill-ablation-no-skill` uses an agent with `skills: []`.
- `skill-ablation-focused-skill` uses an agent with the explicit imported
  skill `kota-ticket-json-procedure`.
- `skill-ablation-noisy-skill` uses an agent with the explicit imported
  skill `kota-outdated-ticket-procedure`.

The imported skills live under `.kota/skills/<name>/SKILL.md` with
`kota-import.json` provenance, so the focused/noisy variants exercise the
same explicit imported-skill loader path normal agents use. The replay
recordings avoid live LLM cost while still forcing the workflow runtime to
write each agent step's real input artifact; the runner inspects those
inputs to prove the expected skill text was or was not present.

Expected direction is intentionally conservative: the focused treatment
passes the predicate set, while the no-skill control and the outdated skill
remain failing variants with their evidence preserved in `fixture-run.json`.
The noisy variant proves a mismatched skill can be represented explicitly
without turning imported skills into global `skills: "all"` content.
