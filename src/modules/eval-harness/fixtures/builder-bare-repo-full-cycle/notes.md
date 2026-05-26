# Builder Bare Repo Full Cycle

This fixture measures a compact full-cycle builder task through the existing
agent-step replay path: the initial tree has source, docs, a workflow-validation
stub, and a local scorer, but no runnable package metadata or tests. The
recorded builder step reconstructs the package test surface, writes
verification tests that cover the seeded bug, fixes the implementation, and
moves the task to done.

The fixture stays predicate-based. `pnpm test` proves the reconstructed command
runs, `scripts/check-behavior.mjs` proves behavior and required verification
coverage, and the `verification_cases` objective metric reports how many
required test cases are visible in the authored test file. The replay recording
exists only to avoid live model/network dependency in the harness execution; it
does not add a second setup DSL or evaluator.

Shortcut guards are covered by the module test:

- fixing `src/project-code.mjs` without adding tests fails;
- adding the required tests while leaving package setup broken fails.
