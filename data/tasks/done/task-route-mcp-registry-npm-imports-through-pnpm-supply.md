---
id: task-route-mcp-registry-npm-imports-through-pnpm-supply
title: Route MCP registry npm imports through pnpm supply-chain policy
status: done
priority: p2
area: modules
summary: Make MCP Registry npm stdio imports emit a pnpm-owned execution path or an explicit operator-reviewed package plan so imported MCP servers cannot bypass KOTA's package-manager and supply-chain guardrails with npx -y.
created_at: 2026-05-25T20:49:52.664Z
updated_at: 2026-05-25T21:12:47.427Z
---

## Problem

KOTA's MCP Registry import surface can turn official npm package metadata into
an executable external MCP server config. The current npm path emits:

```json
{ "command": "npx", "args": ["-y", "<package>@<version>", "..."] }
```

That is a supply-chain and policy gap. Repository standards say package
scripts, dependency installation, and one-off package execution use `pnpm`.
KOTA also has a repo-level pnpm supply-chain policy in `pnpm-workspace.yaml`
(`minimumReleaseAge`, `blockExoticSubdeps`, `trustPolicy`, explicit build
denials). A registry-imported stdio MCP server that runs through `npx -y`
bypasses the package-manager boundary KOTA already chose for package
execution.

The official MCP Registry metadata is only a portable package/install
description. It verifies namespace ownership and points at npm packages, but
it delegates code-security scanning to package registries and downstream
aggregators. KOTA therefore needs to keep its own operator boundary strict
when translating registry metadata into runnable local config.

## Desired Outcome

MCP Registry npm stdio imports no longer generate an `npx -y` command by
default. KOTA either:

- Emits a pnpm-owned execution path for npm stdio packages that preserves the
  package specifier, runtime arguments, package arguments, environment
  variables, and registry URL semantics; or
- Refuses to emit executable config and prints a structured operator-reviewed
  package plan when the metadata cannot be represented without bypassing the
  package policy.

The importer should treat `runtimeHint: "npx"` as upstream npm-package
metadata, not as permission to use npm in KOTA's generated config.

## Constraints

- Keep the change inside `src/modules/mcp-registry/` unless a shared MCP config
  type truly needs to move. The core MCP manager should still receive the same
  strict `McpServerConfig` union.
- Do not execute, install, or probe registry packages during import. This task
  is about the generated config / plan boundary, not package validation by
  side effect.
- Preserve remote Streamable HTTP import behavior.
- Preserve unsupported-package diagnostics for non-npm package types until a
  separate task deliberately adds them.
- Keep registry metadata decoding strict. Do not silently drop required
  operator inputs, `registryBaseUrl`, runtime arguments, package arguments, or
  env values.
- Do not add a second supply-chain scanner or registry trust store. Reuse the
  pnpm policy surface KOTA already has.
- Keep exact emitted command/argument shapes and diagnostics in source tests,
  not durable docs.

## Done When

- npm stdio registry imports no longer emit `command: "npx"` or `-y` in normal
  generated `mcpServers` config.
- The generated npm package execution path uses KOTA's pnpm boundary, or the
  importer emits a non-executable reviewed plan with an actionable diagnostic
  explaining why config was withheld.
- `runtimeHint: "npx"` is still accepted for official npm metadata, but tests
  prove it does not force an npm/npx command into KOTA config.
- `registryBaseUrl`, runtime arguments, package arguments, environment
  variables, and required operator inputs are preserved or rejected loudly.
- Existing remote Streamable HTTP registry imports and unsupported package /
  transport diagnostics remain unchanged.
- Focused tests cover the default npm stdio import, custom registry URL,
  runtime arguments, required env/input values, and the no-`npx` invariant.

## Source / Intent

Explorer run `2026-05-25T20-46-18-097Z-explorer-frjunf` reviewed a queue with
no actionable `ready` / `doing` work. The strategic blocked alternatives were
all still operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External sources checked on 2026-05-25:

- `https://modelcontextprotocol.io/registry/about` says the MCP Registry is a
  preview metadata repository with standardized installation/configuration
  information, namespace verification, and REST discovery. It also says
  security scanning for actual server code is delegated to package registries
  and downstream aggregators.
- `https://modelcontextprotocol.io/registry/package-types` says npm packages
  are represented with `registryType: "npm"` and package ownership is verified
  by matching `package.json` `mcpName` to the registry server name.
- `https://pnpm.io/supply-chain-security` documents pnpm's local mitigations:
  dependency script blocking, `blockExoticSubdeps`, `minimumReleaseAge`,
  `trustPolicy`, and committed lockfiles.

Local evidence:

- `docs/STANDARDS.md` requires `pnpm` for package scripts, dependency
  installation, and one-off package execution.
- `pnpm-workspace.yaml` sets KOTA's package-install safety policy.
- `src/modules/mcp-registry/registry-import.ts` currently builds npm stdio
  config as `command: "npx"` with `args: ["-y", ...]`.
- `src/modules/mcp-registry/registry-import.test.ts` and
  `src/modules/mcp-registry/index.test.ts` assert the current `npx` output.
- Completed task `task-add-mcp-registry-backed-external-server-config-import`
  added the registry import path before this pnpm boundary issue was noticed.

## Initiative

MCP ecosystem readiness and repository supply-chain safety: KOTA should consume
portable MCP server metadata without bypassing the package-manager policy it
uses everywhere else.

## Acceptance Evidence

- Focused tests pass, for example
  `pnpm test src/modules/mcp-registry/registry-import.test.ts src/modules/mcp-registry/index.test.ts`.
- Supply-chain policy validation remains green, for example
  `pnpm test src/pnpm-supply-chain-policy.integration.test.ts`.
- A transcript or fixture under `.kota/runs/<run-id>/` shows `kota
  mcp-registry import ... --install-method npm` producing pnpm-owned config or
  an explicit non-executable package plan, with no `npx` in the emitted JSON.
- A negative assertion or fixture proves a future `npx` regression in
  registry-generated npm config fails loudly.
