---
id: task-add-mcp-registry-backed-external-server-config-import
title: Add MCP registry-backed external server config import
status: ready
priority: p2
area: modules
summary: Resolve MCP Registry-compatible server metadata into strict KOTA external MCP server config so operators can adopt portable server entries without manual JSON transcription or a second capability registry.
created_at: 2026-05-22T06:49:29Z
updated_at: 2026-05-22T06:49:29Z
---

## Problem

KOTA can connect to manually configured external MCP servers through the core
MCP manager, including stdio and Streamable HTTP entries, but it has no
registry-backed way to resolve portable MCP server metadata into that strict
`mcpServers` config shape. Operators must copy JSON by hand from registry
entries, decide whether `packages` or `remotes` are supported, and discover
unsupported or unsafe metadata only after editing config or attempting a
connection.

The official MCP Registry now defines a preview metadata ecosystem,
`server.json` package and remote shapes, and a registry-compatible REST API
for downstream registries and host applications. KOTA should consume that
standard metadata at the operator boundary without turning the registry into a
second tool or capability catalog.

## Desired Outcome

KOTA has a module-owned operator path that fetches one server from an
MCP Registry-compatible endpoint by name and version, validates the metadata
against KOTA's supported external MCP transports, and produces an explicit
KOTA `mcpServers` entry or a loud unsupported-metadata diagnostic.

The first slice should cover the portable cases KOTA can already execute:

- remote Streamable HTTP server metadata, including required headers or URL
  variables surfaced as operator inputs rather than silently dropped;
- npm stdio package metadata that maps cleanly to a command plus arguments;
- deleted, deprecated, unknown package type, or ambiguous multi-transport
  entries rejected before they reach the core MCP manager.

## Constraints

- Keep this as an operator/import surface around external MCP server config.
  Do not add a second runtime tool registry or auto-install arbitrary registry
  packages during import.
- Preserve the core MCP manager's strict config union. Registry decoding should
  normalize once at the boundary and then emit the same explicit config shape
  manual entries use.
- Support registry-compatible endpoints through the official OpenAPI shape
  rather than scraping the web UI.
- Keep exact registry field parsing, status handling, and output JSON in source
  types and focused tests, not durable prose.
- Do not treat the official public registry as the only possible source; the
  docs explicitly allow downstream and private registries that implement the
  same API.

## Done When

- A module-owned CLI/operator command can resolve a registry server name and
  version from a configurable registry base URL.
- The command emits or applies one strict KOTA external MCP server config entry
  for supported metadata, with no lossy coercion of unsupported fields.
- Unsupported package types, unsupported transports, deleted/deprecated
  statuses, missing required operator inputs, and ambiguous install choices
  fail with actionable diagnostics before any config is written.
- Focused tests cover remote Streamable HTTP metadata, npm stdio package
  metadata, and at least three unsupported/error cases.
- A CLI transcript under `.kota/runs/<run-id>/` shows a successful resolve and
  one rejected unsupported registry entry.

## Source / Intent

Explorer run `2026-05-22T06-45-08-375Z-explorer-5haopr` reviewed a queue with
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
pnpm kota task create "Add MCP registry-backed external server config import" --state ready --area modules --priority p2 --summary "Resolve MCP Registry-compatible server metadata into strict KOTA external MCP server config so operators can adopt portable server entries without manual JSON transcription or a second capability registry."
```

It failed before writing a file with `Fatal: fetch failed`, so this normalized
task was created manually.

External signals checked:

- `https://modelcontextprotocol.io/registry/about` describes the official MCP
  Registry as preview metadata infrastructure with standardized installation
  and configuration data, namespace verification, and a REST API for discovery.
- `https://modelcontextprotocol.io/registry/remote-servers` defines public
  `remotes` metadata for Streamable HTTP/SSE servers, URL variables, headers,
  and coexistence with local package installs.
- `https://modelcontextprotocol.io/registry/registry-aggregators` documents the
  registry-compatible REST API, cursor pagination, `updated_since`, server
  status updates, and downstream subregistries with `_meta` extensions.

Local evidence:

- `src/core/mcp/AGENTS.md` says the core MCP client/manager connects KOTA to
  external MCP servers and merges their tools into the runtime tool list.
- `src/core/mcp/manager.ts` accepts strict `stdio` and `http` server config
  entries and rejects ambiguous transport shapes.
- `src/modules/mcp-server/registry-metadata.ts` and
  `server.json` cover KOTA publishing first-party server metadata, but no
  open task or code path consumes registry metadata for external MCP server
  configuration.

## Initiative

MCP ecosystem readiness: KOTA should consume portable MCP server metadata at
the operator boundary while preserving its strict external-server config and
module-owned capability model.

## Acceptance Evidence

- Focused tests for the registry import parser and command pass.
- `pnpm test src/core/mcp/manager.test.ts` still passes or the touched subset
  demonstrates unchanged strict config behavior.
- A transcript under `.kota/runs/<run-id>/` captures the command output for a
  supported registry entry and an unsupported/deprecated entry.
