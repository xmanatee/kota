---
id: task-add-mcp-registry-metadata-for-kotas-first-party-ser
title: Add MCP registry metadata for KOTA's first-party server
status: ready
priority: p2
area: modules
summary: Add official MCP Registry metadata and validation for KOTA's first-party MCP server so its stdio package and future remote transport are discoverable without inventing a second registry.
created_at: 2026-05-22T06:09:41Z
updated_at: 2026-05-22T06:09:41Z
---

## Problem

KOTA now exposes a first-party MCP server through the `mcp-server` module over
stdio and Streamable HTTP, but the repo has no official MCP Registry metadata:
no `server.json`, no `package.json` `mcpName`, no validation command, and no
release/check path that proves the metadata stays aligned with the package
version and advertised transports.

That leaves discoverability outside KOTA's own CLI implicit. It also means the
future public HTTP/remote server path has no prepared metadata surface for
registries, marketplaces, or server-card-style discovery to consume. This is
not another MCP method-handler gap; it is publication metadata for the
module-owned MCP surface that already exists.

## Desired Outcome

KOTA has a strict, repo-owned MCP Registry metadata path for its first-party
server:

- a `server.json` that describes the KOTA MCP server, repository, package,
  version, and stdio transport;
- `package.json` verification metadata that matches the registry server name;
- a validation script or focused test that fails when package version, package
  identifier, `mcpName`, or `server.json` drift apart;
- a clear extension point for adding `remotes` once the Streamable HTTP
  endpoint is publicly publishable, without advertising private localhost-only
  endpoints as public registry remotes.

## Constraints

- Keep ownership with the `mcp-server` module and package/release surface. Do
  not create a second KOTA registry or a generic module marketplace.
- Use the official MCP Registry `server.json` shape and npm package
  verification convention. Do not invent a parallel manifest format.
- Do not require registry authentication, `mcp-publisher publish`, or a public
  remote URL for this task to complete. Publication is an operator action after
  the metadata is valid.
- Do not advertise a localhost-only Streamable HTTP endpoint as a public
  `remotes` entry. Add that only when KOTA has an intentionally public remote
  deployment story.
- Keep exact JSON field validation in code/tests rather than durable prose.

## Done When

- `server.json` exists at the repo/package root with the official schema URL,
  `name: "io.github.xmanatee/kota"`, package metadata for the `kota` npm
  package, repository URL `https://github.com/xmanatee/kota`, and stdio
  transport for `kota mcp-server`.
- `package.json` includes the matching `mcpName` value required for npm package
  ownership verification.
- A package script or focused test validates that `server.json.version`,
  `server.json.packages[0].version`, and `package.json.version` match, and that
  `server.json.name` equals `package.json.mcpName`.
- The validation path also rejects any `remotes` entry pointing at localhost,
  loopback, private network names, or otherwise non-public endpoints.
- Existing built CLI MCP smoke tests remain green.

## Source / Intent

Explorer run `2026-05-22T06-06-43-502Z-explorer-5e8puj` reviewed a queue with
zero actionable `ready`/`doing` tasks. The dependency-waiting backlog tasks
were still blocked on authenticated source access, and all strategic blocked
alternatives were operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Add MCP registry metadata for KOTA's first-party server" --state ready --area modules --priority p2 --summary "Add official MCP Registry metadata and validation for KOTA's first-party MCP server so its stdio package and future remote transport are discoverable without inventing a second registry."
```

It failed before writing a file with `Fatal: fetch failed`, so this normalized
task was created manually.

External signals checked:

- `https://modelcontextprotocol.io/registry/about` describes the official MCP
  Registry as centralized metadata for publicly accessible MCP servers, with
  standardized installation/configuration data in `server.json`.
- `https://modelcontextprotocol.io/registry/quickstart` requires npm-backed
  servers to set `package.json` `mcpName` matching `server.json.name`, and then
  publish the `server.json` metadata through `mcp-publisher`.
- `https://modelcontextprotocol.io/registry/remote-servers` allows `packages`
  and `remotes` to coexist, but remote entries must be publicly accessible.
- `https://modelcontextprotocol.io/development/roadmap` names MCP Server Cards
  and configuration portability as active ecosystem directions.
- `https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1649`
  drafts server-card discovery through `.well-known/mcp.json`, reinforcing that
  pre-connection metadata should be derived from the same strict source rather
  than from an ad hoc KOTA catalog.

Local evidence:

- `git remote -v` points at `https://github.com/xmanatee/kota.git`.
- `package.json` names the npm package `kota` and version `0.1.0`, but has no
  `mcpName`.
- Repository search found no `server.json`, `mcp-publisher`, or MCP Registry
  validation path.
- `src/modules/mcp-server/AGENTS.md` says the module owns the KOTA MCP server
  over stdio and Streamable HTTP and treats MCP as a transport over KOTA
  capabilities, not a second capability registry.

## Initiative

MCP ecosystem readiness: KOTA's first-party MCP server should be discoverable
through official metadata while preserving the local module-owned MCP boundary.

## Acceptance Evidence

- Focused validation passes, for example `pnpm test src/modules/mcp-server`
  plus the new metadata validation test or script.
- Built CLI MCP smoke remains green, for example
  `pnpm test src/built-cli-mcp-server.integration.test.ts`.
- Running the new validation path against an intentionally mismatched
  `mcpName` or version fixture fails with an explicit error naming the drift.
