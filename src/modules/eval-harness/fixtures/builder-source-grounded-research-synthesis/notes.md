# builder-source-grounded-research-synthesis

## Source

Recording source: `2026-06-24T04-39-44-641Z-builder-gfdmek`.

This is a replay-backed smoke fixture for the local research synthesis gap:
the builder must turn conflicting, source-backed notes into a machine-readable
decision artifact with auditable citations and explicit conflict handling. No
past KOTA failure run exists for this exact measurement gap, so the fixture is
not `real-failure` provenance; the completed source workflow run, source
commit, and replay authoring commands are tracked in `recordings/provenance.md`.

## Shape

The fixture seeds five plain markdown sources under `research/packet/`. Three
tempting notes point toward Cloud OCR, but they are stale, speculative, or
narrower than the release constraints. Two decisive June sources require
`local-first-markdown`: the security review blocks external OCR for customer
tickets, and the production pilot shows the local path meets the offline
release threshold.

`scripts/check-research-synthesis.mjs` is the fixture-owned verifier. It parses
`research-synthesis-result.json`, rejects invented source ids and path
mismatches, requires both decisive citations, requires concrete rejection
reasons for weaker sources, validates conflict-resolution fields, rejects
source packet and verifier edits through changed-path checks, and writes
`research-synthesis-verification.json`.

The answer space is intentionally narrow because the release constraint is
hard: Cloud OCR cannot be selected for the Q3 offline support-triage release
without contradicting the security and pilot sources. Golden and adversarial
calibration are sufficient; an accepted alternative would blur the decision the
fixture is meant to measure.
