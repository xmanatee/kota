---
id: task-extension-lifecycle-test-coverage
title: Add test coverage for extension loading, lifecycle, and contribution wiring
status: done
priority: p2
area: architecture
summary: The extension loading and lifecycle system (onLoad, onUnload, contribution registration) has minimal test coverage. As the architecture migration moves more capability behind extension boundaries, gaps in lifecycle test coverage make safe refactoring harder.
created_at: 2026-04-08T00:00:00Z
updated_at: 2026-04-08T00:00:00Z
---

## Problem

The extension lifecycle — discovering extensions, calling `onLoad`, registering their tool/channel/command/skill contributions, calling `onUnload`, and re-registering on reload — is the foundation of the extension-first architecture. But it has thin unit test coverage. The existing `registry.test.ts` is limited in scope and does not exercise the full lifecycle.

As the architecture migration moves more capability out of `src/tools/` and behind extension boundaries, each move creates a regression risk that only good lifecycle tests would catch. Without this coverage, the architecture migration work in `ready/` is harder to validate safely.

## Desired Outcome

- Core extension lifecycle behaviors are covered by focused unit tests: load, unload, contribution registration, reload behavior, duplicate-registration guards, and error handling when `onLoad` throws.
- Tests live close to the relevant loader/registry code rather than in a catch-all integration suite.
- Running `npm test` after architecture refactors gives a meaningful green/red signal for extension system correctness.

## Constraints

- Do not add tests for every tool implementation — focus on the lifecycle and registration surface, not tool behaviors.
- Tests should run in-process without a real daemon or filesystem dependency where possible.
- Test file placement should follow the per-extension directory layout established in `src/extensions/web-access/` (the reference implementation).

## Done When

- Extension load, unload, and contribution wiring have unit test coverage.
- At least one error path (e.g., `onLoad` throwing) is explicitly tested.
- Tests pass in `npm test` and are not skipped.
