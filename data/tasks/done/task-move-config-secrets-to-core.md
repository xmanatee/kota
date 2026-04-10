---
id: task-move-config-secrets-to-core
title: "Move config and secrets helpers from src/ root to src/core/config/"
status: done
priority: p2
area: architecture
summary: "config.ts, config-warnings.ts, secrets.ts, and secret-providers.ts are kernel-owned configuration helpers sitting as loose root files. Moving them into src/core/config/ is a small, coherent cluster that advances the core/modules directory split."
created_at: 2026-04-11T00:10:00Z
updated_at: 2026-04-11T00:10:00Z
---

## Problem

The repo's `src/` root still has 34 loose implementation files despite the
`src/core/` + `src/modules/` split being in place. The broader consolidation
task timed out because it tried to move too many files at once. This task
targets the smallest coherent cluster: configuration and secrets management.

These four files are clearly kernel-owned:

- `config.ts` — KOTA configuration schema (global + project-level)
- `config-warnings.ts` — configuration validation and known-key checking
- `secrets.ts` — secrets management with provider-based resolution and masking
- `secret-providers.ts` — secret provider implementations (env, file, keychain)

## Desired Outcome

All four files live under `src/core/config/`, imports across the codebase are
updated, a local `AGENTS.md` exists for the new directory, and the build and
tests pass.

## Constraints

- No compatibility shims or re-export wrappers.
- Update any `AGENTS.md` files that reference these files or their old paths.
- Keep the move mechanical — do not refactor the files themselves.

## Done When

- `src/core/config/` contains the four files with updated internal imports.
- No remaining imports point to the old `src/` root paths for these files.
- Build, typecheck, lint, and tests pass.
