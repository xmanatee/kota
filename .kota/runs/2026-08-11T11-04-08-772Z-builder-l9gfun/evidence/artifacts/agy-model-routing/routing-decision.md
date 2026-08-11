# AGY model-routing decision

Decision: **needs more data**.

The live benchmark did not start. The configured `antigravity-cli` preset maps
its capable tier to `gemini-3.6-flash` at KOTA effort `max`, but configuration
is not behavioral evidence. This run cannot confirm or revise that mapping
because the mandatory isolation and readiness preflight failed:

- no Docker engine is reachable from the default context;
- no operator-configured Google provider-egress network, proxy, or candidate
  image is available; and
- `agy models` exits 1, so AGY authentication and the required
  `gemini-3.6-flash-high` catalog entry cannot be verified.

The next valid run must compare `gemini-3.6-flash` with the prior capable-tier
candidate `gemini-3.1-pro` at `--effort max --repeats 3`, through the real
containerized `antigravity-cli` execution path. It must retain the suite report,
availability evidence, all planning/scoped-coding/repair traces, changed-path
reports, rubric verdicts, and the full command transcript. Confirm the preset
only if Gemini 3.6 Flash wins or ties the relevant coding/autonomy criteria,
every selected-model run reaches AGY at native effort `high`, and there are zero
unexplained instruction or changed-path scope regressions.
