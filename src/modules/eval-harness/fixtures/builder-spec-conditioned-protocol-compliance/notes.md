# Builder Spec-Conditioned Protocol Compliance

This replay-backed builder fixture seeds a tiny Window Envelope Protocol
project. The visible `node test/protocol-generic.test.mjs` checks only generic
defensive behavior. The fixture scorer in `scripts/check-protocol.mjs` requires
the builder to apply the fixture-owned `SPEC.md` clauses for exclusive window
bounds, canonical id matching, duplicate resolution, and required extension
gating.

The verifier also validates `spec-compliance-result.json` so final prose is not
accepted as evidence. The artifact must name the exercised clause ids, local
verification commands, generic and spec-dependent case counts, changed
implementation paths, and provenance pointing back to `SPEC.md`.

`node scripts/check-protocol.mjs --self-test-shortcuts` exercises focused
negative candidates for hardcoded visible samples, missing clause evidence, and
spec/verifier edits. The fixture uses null, golden, and adversarial verifier
calibration because the intended compliant implementation space is narrow
enough that no accepted-alternative case is needed.
