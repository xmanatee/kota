---
id: task-define-the-canonical-protected-read-plan-for-nativ
title: Define the canonical protected-read plan for native CLI sandboxes
status: ready
priority: p1
area: security
task_class: Safety
summary: Create one native-harness contract that identifies project credentials and existing authority-token protections across lexical and resolved filesystem paths.
created_at: 2026-08-05T12:41:31.394Z
updated_at: 2026-08-05T12:41:31.394Z
---

## Problem

    Native sandbox construction currently receives recursively readable roots and a narrow authority-token list, but no canonical representation of `.kota/daemon-control.json`, `.kota/secrets.json`, or `.env*` paths. Platform-specific fixes would otherwise duplicate matching and alias-resolution logic and could drift.

## Desired Outcome

    Native sandbox setup derives a typed, deduplicated protected-read plan covering daemon control data, KOTA secrets, environment-file variants, existing authority credentials, and relevant realpath aliases without reading secret contents or removing ordinary repository roots.

## Constraints

- Preserve the existing scope-authority credential protections and treat project credential paths as additions to the same security boundary.
- Match the repository filesystem module's protected-path semantics rather than introducing a competing secret-name policy.
- Handle project-root and cwd aliases, symlinks, missing optional files, nested `.env*` entries, and duplicate paths deterministically.
- Do not read, copy, log, serialize, or include protected file contents in diagnostics or test output.
- Keep ordinary repository files and read-only Git metadata in the native readable-root set.

## Done When

- A shared native-sandbox API produces the complete protected-read plan from the effective project, cwd, state, and authority context.
- The plan includes both lexical and safely resolved paths needed to prevent alias-based access to the protected targets.
- Focused tests cover project-root cwd, aliased roots, nested `.env*` variants, missing protected files, authority credentials, deduplication, and preservation of normal readable roots.
- The task records the exact focused verification command and passing result.

## Source / Intent

    Preserves the confirmed finding `native-cli-sandbox-exposes-project-runtime-secrets` from security-review run 2026-08-05T06-14-25-967Z-security-review-rit42r and isolates the shared prerequisite exposed by failed builder run 2026-08-05T11-38-20-250Z-builder-lm91sm.

Decomposed from `task-security-review-native-cli-agents-can-read-protect` after builder run `2026-08-05T11-38-20-250Z-builder-lm91sm` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused unit-test output demonstrating the protected-read plan for literal, nested, symlinked, and realpath-resolved fixtures.
- A test proving ordinary repository content and read-only Git metadata remain classified as readable.
- A reviewable assertion that fixture secrets use sentinels and no protected contents enter logs or snapshots.
