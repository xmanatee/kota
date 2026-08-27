---
status: open
priority: p1
depends_on: [task-remove-module-lifecycle-test-duplication, task-prune-memory-knowledge-history-task-adapters, task-prune-recall-answer-read-adapters, task-prune-capture-retract-write-adapters, task-prune-cli-rendering-test-duplication, task-prune-web-mobile-apple-test-duplication, task-prune-external-channel-test-duplication, task-migrate-autonomy-workflow-families, task-reduce-mcp-server-interoperability-suite, task-prune-deterministic-eval-harness-tests]
---

# Collapse root integration and obsolete test support

## Scope / Starting Points

Inventory root and cross-module integration tests, built/source CLI variants, local/daemon variants, route/client/CLI mirrors, numbered suites, fake runtimes, global resets, catalogs, snapshots, migration fixtures, compatibility aliases, legacy branches, and all authored test-support consumers.

## Required Changes

- Record the exact packaging, process, protocol, persistence, or operator composition defect for every retained journey.
- Retain real boundaries; remove integrations whose mocks eliminate the boundary they claim to prove.
- Collapse built/source, local/daemon, and route/client/CLI variants unless each catches a distinct packaging or process failure.
- Delete helpers, fixtures, snapshots, fake runtimes, numbered parts, resets, aliases, migration paths, and legacy branches immediately after their final current consumer is removed.
- Simplify production ownership instead of adding cleanup hooks to preserve test fixtures.

## Must Not Complete While

Any integration/support file is unclassified, any retained journey lacks a distinct composition failure, any compatibility path lacks a current support policy, or deleted LOC has moved into helpers/fixtures/generated data.

## Done When

The journey/support inventory has zero unresolved rows; every retained journey crosses a real boundary; all obsolete support and production compatibility mechanisms are deleted with their consumers.

## Acceptance Evidence

Provide the journey/failure/disposition matrix, final support-consumer graph, and before/after root integration, authored-support, fixture, and implicated production LOC.

## Initiative

Final cleanup stage before the program-wide reduction audit.
