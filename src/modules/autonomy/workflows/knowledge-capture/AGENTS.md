# Knowledge Capture Workflow

This workflow automatically extracts structured insights from completed
builder and improver runs into the knowledge store.

- Triggers on `workflow.completed` for builder/improver with status `success`.
- Reads `run-summary.json` and `commit-message.txt` from the completed run directory.
- Creates a `run-insight` knowledge entry tagged with run ID, workflow name, and task ID.
- Idempotent: skips if an entry for the same run ID already exists.
