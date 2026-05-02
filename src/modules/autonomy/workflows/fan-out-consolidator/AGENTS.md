# Fan-out Consolidator Workflow

Code-only workflow that detects completed multi-client fan-out batches and
seeds one consolidation review task per new batch in `ready/`.

- Owns deterministic queue-shaping for cross-client coherence reviews. There
  is no agent step here — the seeded task is the actionable artifact and a
  builder run picks it up next.
- Idempotent by capability key: re-detection of the same batch is a noop.
- Detection logic and task body live in `#modules/autonomy/fan-out-consolidation.js`
  so the proposer is testable as pure code.
- The seeded task is `area: client` so the rendered-evidence validator gate
  fires; a builder that tries to clear the consolidation with prose-only
  test logs is rejected.
