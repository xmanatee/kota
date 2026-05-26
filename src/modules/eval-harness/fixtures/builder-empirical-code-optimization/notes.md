# builder-empirical-code-optimization

## Source

No source run id. This is a live-builder smoke fixture for the empirical-code
optimization shape that motivated objective metric reporting: an agent must
improve code against a deterministic numeric score, and the harness records
the score independently of the agent's final summary.

## Shape

The fixture seeds a small forecasting project. `src/predictor.mjs` starts as a
deliberately weak baseline, `data/forecast/training.csv` exposes enough rows to
infer the relationship, and `scripts/score.mjs` evaluates the predictor against
deterministically generated holdout rows. The task asks the builder to improve
the predictor only.

Pass/fail still comes from predicates: the holdout MAE threshold must pass, the
task must move to `done/`, and `git-changes-within` rejects edits to the scorer,
training data, or package scaffolding. The `forecast_mae` objective metric
reports the observed numeric score as evidence in the run artifact and
aggregate output.

This stays out of `pnpm test` because it invokes a live builder agent. Replay
fixtures cover workflow-layer regressions in the smoke gate; this fixture
covers generator behavior on a measured optimization task.
