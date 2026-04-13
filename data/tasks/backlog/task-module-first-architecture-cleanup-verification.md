---
id: task-module-first-architecture-cleanup-verification
title: Verify module-first architecture cleanup after focused fixes
status: backlog
priority: p1
area: architecture
summary: After the focused module-first cleanup tasks land, perform an evidence-based pass that checks the architecture is simple, strict, structured, and not drifting.
created_at: 2026-04-13T11:16:25Z
updated_at: 2026-04-13T11:16:25Z
---

## Problem

The current audit found several related module-first gaps: incomplete tool
metadata strictness, hardcoded autonomy workflow inventories, weak dependency
declarations, config validation drift, reload semantics ambiguity, top-level
shared helpers, flat module buckets, stale terminology, and package-manager
drift. These should be fixed through focused tasks, then reviewed together so
the repo does not end with local patches that leave the overall architecture
unclear.

## Desired Outcome

A final verification pass checks that the focused fixes form a coherent result:
core is smaller and stricter, modules are clean ownership boundaries, dynamic
loading behavior is honest, docs are concise and current, and no obvious
leftovers remain.

## Constraints

- Depends on:
  - `task-enforce-strict-module-tool-metadata`
  - `task-remove-hardcoded-autonomy-workflow-inventory`
  - `task-align-config-validation-with-module-config-keys`
  - `task-declare-and-validate-module-dependencies`
  - `task-extract-composition-tools-from-core-into-an-option`
  - `task-make-module-load-failure-policy-explicit`
  - `task-make-module-reload-reimport-source`
  - `task-rehome-shared-notification-retry-helper`
  - `task-review-core-runtime-bucket-boundaries`
  - `task-structure-workflow-ops-module-subdomains`
  - `task-structure-web-ui-module-subdomains`
  - `task-audit-remaining-core-hosted-tools-after-composition`
  - `task-clean-module-terminology-and-doc-leftovers`
  - `task-normalize-mobile-client-package-manager`
- Do not do broad implementation work in this verification task unless the
  remaining issue is tiny and clearly part of verification.
- If a dependency is still open, keep this task in backlog.

## Done When

- Searches show no active hardcoded autonomy workflow inventory remains.
- Module tool metadata is strict and no project module loads with missing risk or kind.
- Cross-module production imports are either local to the same module, declared dependencies, or replaced by core protocols.
- `src/modules/` has no top-level production helper files besides local instructions.
- The largest flat directories have either been structured or have a documented boundary-level reason to stay flat.
- Current docs and local instructions are concise, accurate, and free of stale migration/extension/package-manager drift.
