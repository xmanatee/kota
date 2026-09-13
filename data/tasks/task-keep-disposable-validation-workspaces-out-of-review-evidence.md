---
status: open
priority: p2
---
# Keep disposable validation workspaces out of review evidence

## Outcome

Builders and other agents can perform isolated validation without exporting
their copied source tree, compiled output and temporary workspace as reviewer
evidence. Critics retain readable selected results and necessary reproducers;
scratch contents cannot crowd them out. Keep the existing runtime isolation,
artifact-retention and cleanup owners rather than adding a publication protocol.

## Evidence

The active MCP interoperability run
`2026-09-13T12-15-26-827Z-builder-inxnff` has a useful isolated validation
workspace under its agent directory. At 2026-09-13 14:17 UTC, its latest
`evidence-references.md` contains 3,750 entries, including 3,710 from
`agent/verification-workspace/`, and reports
`Artifact selection exceeds 4096 entries`. The index is about 3 MB and retains
compiled JavaScript, source maps and declaration files as evidence originals and
projections. The critic still found substantive defects; this observation does
not prove all review evidence is inaccessible or that the work should stop.

`src/core/workflow/run-artifact-handoff.ts` recursively retains supplied roots.
Native isolation already provides temporary locations through
`src/core/agent-harness/native-cli-sandbox.ts` and `native-cli-environment.ts`;
the run sandbox also owns temporary and artifact directories. Trace their actual
writer/critic consumers and lifetime guarantees before choosing the correction.
Do not assume every directory under agent output is an authored deliverable.

## Acceptance

- Use the existing run/invocation scratch and artifact contracts consistently.
  Validation tooling has an authorized, discoverable scratch location with the
  necessary lifetime; retained reports can reference provenance without copying
  disposable workspaces into each handoff.
- A representative validation writes generated scratch output plus a result and
  necessary small reproducer. The actual reviewer handoff includes the latter,
  not the generated tree; missing required evidence remains explicit. The same
  behavior applies to ordinary agents and nested critic/repair calls.
- Preserve genuine authored artifacts, isolation and safe retry/recovery. Do not
  delete the active run's workspace or historical evidence as a shortcut. Normal
  terminal cleanup and existing retention own disposable-data reclamation.
- Do not raise artifact limits, special-case this workspace name, add another
  store, scan every source file, or prescribe per-workflow export schemas. Extend
  a focused existing owner scenario for the distinction and remove any replaced
  path. Report unperformed broader checks honestly.
