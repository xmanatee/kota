---
id: task-remove-implicit-package-auto-install-from-code-exec
title: Remove implicit package auto-install from code_exec
status: ready
priority: p2
area: modules
summary: Make code_exec report missing dependencies without silently invoking package managers, so dependency changes go through explicit guarded commands and KOTA's pnpm supply-chain policy.
created_at: 2026-05-18T03:00:53Z
updated_at: 2026-05-18T03:00:53Z
---

## Problem

`code_exec` is registered as a local write tool, but a missing import can make it
silently invoke a package manager before retrying the user code. The Python path
runs a direct package install through the active interpreter and the Node path
runs a non-pnpm package-manager install command. Failed installs are swallowed
and the user only sees the original missing-package output plus a hint.

That makes a single `code_exec` call perform hidden external network and
supply-chain work that is not visible in the tool's effect declaration,
guardrail decision, or pnpm install safeguards. It also violates KOTA's package
manager convention by using a non-pnpm Node install path.

## Desired Outcome

`code_exec` should execute code in the existing REPL and report missing
dependencies honestly. It should not install packages or mutate dependency
state as a side effect of running code. Dependency changes must happen through
explicit operator-visible commands or a future dedicated tool with an honest
effect declaration, approval path, and package-manager policy.

## Constraints

- Keep `code_exec` in the execution module; do not add a parallel code-runner
  surface.
- Preserve the existing missing-package hints, but make them suggestions only.
- Do not add a config flag or test-only override to keep the old auto-install
  behavior alive.
- Do not weaken the REPL state, timeout, plot-capture, or missing-package
  parsing behavior outside the install side effect.
- If any future automatic dependency install is intentionally introduced, it
  must be an explicit tool or command path with `openWorld` / network effect
  semantics and pnpm policy coverage, not hidden inside `code_exec`.

## Done When

- `runCodeExec` no longer calls any package manager
  when a missing Python or Node dependency is detected.
- Missing Python and Node dependencies return the original error plus the
  existing install hint, with no `[Auto-installed ...]` output and no automatic
  retry after installation.
- Tests cover both Python and Node missing-package paths and assert no
  package-manager subprocess is invoked.
- The Node path contains no production non-pnpm install fallback; any JavaScript
  dependency guidance names the canonical pnpm command.
- Existing `code_exec` tests for successful execution, timeout recovery,
  session restart, plot capture, and missing-package parsing still pass.

## Source / Intent

Explorer run `2026-05-18T02-58-11-984Z-explorer-japm0f` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` were all operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Remove implicit package auto-install from code_exec" --state ready --area modules --priority p2 --summary "Make code_exec report missing dependencies without silently invoking package managers, so dependency changes go through explicit guarded commands and KOTA's pnpm supply-chain policy."
```

It failed before writing a file because the workflow sandbox returned
`Fatal: fetch failed`. This file follows the normalized task schema manually.

External signal checked:

- `https://github.com/huggingface/smolagents` still centers code-executing
  agents and explicitly warns that its local Python executor is not a security
  sandbox; it points users toward isolated execution backends such as managed
  sandboxes, Docker, or Pyodide+Deno WebAssembly.

Local inspection found:

- `src/modules/execution/code-exec.ts` detects missing packages and calls
  `tryAutoInstall`, which invokes a Python package install or a non-pnpm Node
  package install before rerunning the code.
- `src/modules/execution/index.ts` declares `code_exec` with
  `localWriteEffect()`, so guardrails see a local filesystem write, not an
  open-world dependency installation.
- `pnpm-workspace.yaml` already carries repo-level supply-chain safeguards,
  including `minimumReleaseAge`, that this hidden Node install path bypasses.

## Initiative

Execution-module safety: code execution should not smuggle dependency
installation, network access, or package-manager policy exceptions through a
general REPL tool.

## Acceptance Evidence

- Focused test transcript for the execution module, for example:

```sh
pnpm test src/modules/execution/code-exec.test.ts
```

- Diff review shows `code_exec` no longer contains package-manager subprocess
  calls and no production non-pnpm install path remains.
- A missing-package test fixture or transcript shows `code_exec` returning an
  install hint without installing or retrying the dependency automatically.
