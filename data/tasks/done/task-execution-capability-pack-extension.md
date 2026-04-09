---
id: task-execution-capability-pack-extension
title: Move shell and process execution tools into a built-in extension capability pack
status: done
priority: p2
area: architecture
summary: shell, process, code-exec, and computer-use still live in src/tools/ as core-hosted tools. Migrating them to a src/extensions/execution/ capability pack continues the minimal-core migration started by the web-access extension.
created_at: 2026-04-08T00:50:00Z
updated_at: 2026-04-08T00:50:00Z
---

## Problem

Shell execution (`shell`), process control (`process`), code execution (`code_exec`), and computer use (`computer_use`, `screenshot`) are a coherent, high-risk capability family. They currently live as hardcoded entries in `src/tools/index.ts` with their implementations scattered across multiple files in `src/tools/`. The web-access extension demonstrated that grouping a capability family behind an extension boundary improves co-location, testability, and scope clarity.

Moving these tools to an extension also makes the high-risk execution surface more explicit: the extension can document its scope, carry its own guardrail metadata, and be independently disabled if needed.

## Desired Outcome

A `src/extensions/execution/` directory that owns:
- `shell`, `process`, `code_exec` tool implementations
- `computer_use` and `screenshot` tool implementations (or a sub-extension if the computer-use surface warrants it)
- An `index.ts` that exports a `KotaExtension` registering all tools via `onLoad`
- Co-located tests for lifecycle and representative tools

The tools are removed from `src/tools/index.ts` core registrations. `src/tools/AGENTS.md` and `src/extensions/AGENTS.md` are updated.

## Constraints

- Tool names, schemas, and behavior must not change.
- No compatibility aliases or dual-registration paths.
- The extension must load unconditionally (built-in).
- Follow the `src/extensions/web-access/` directory layout as the reference pattern.
- Filesystem tools (`file_read`, `file_write`, `file_edit`, etc.) are a separate migration — do not bundle them here.
- If computer-use platform helpers (`computer-use-actions-mac.ts`, `computer-use-actions-linux.ts`) are large, keep them as internal helpers inside the extension directory.

## Done When

- `src/extensions/execution/` exists and contains the migrated tools and tests.
- `src/tools/index.ts` no longer imports or hardcodes the migrated tools.
- `npm test` passes.
- `src/tools/AGENTS.md` and `src/extensions/AGENTS.md` reflect the updated ownership.
