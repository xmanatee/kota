# Repo AI Checks Module

This module owns the repo-local AI check-file import boundary.

- Treat `.continue/checks/*.md` and `.agents/checks/*.md` as external file
  formats that are normalized into typed KOTA check definitions.
- Keep parsing, precedence, provenance, and diagnostics here instead of
  spreading markdown handling through workflows.
- Workflows may execute these definitions, but this module remains the source
  of truth for discovery semantics and emitted check-result event shapes.
- Do not add a hosted check-runner control plane or a separate approval path;
  workflows should keep using KOTA's normal workflow, agent, artifact, and
  tool primitives.
