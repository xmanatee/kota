# Validate eval-harness fixture provenance

The eval harness documentation says fixtures should be sourced from real
autonomy failures, with a narrow smoke-fixture exception. The loader validates
`fixture.json` shape and `initial/`, but it does not validate `notes.md` or the
claimed provenance rules.

Evidence:
- `src/modules/eval-harness/fixture.ts` accepts fixtures without checking
  `notes.md`, source run ids, or smoke-fixture justification.
- `src/modules/eval-harness/AGENTS.md` describes provenance as a contribution
  rule, but that rule is currently social, not executable.

Desired direction:
- Move fixture provenance requirements into a small validation path used by the
  eval harness tests/CLI.
- Keep the rule strict: real failure fixture or explicitly justified smoke
  fixture, with no undocumented fallback path.

