---
status: done
---

# Add private MCP tunnel connector support

## Problem

KOTA can expose tools over local MCP transports and import MCP Registry-style
external server config, but private MCP servers still need either local
in-process reachability or a public HTTP endpoint. OpenAI's Secure MCP Tunnel
docs now show a product pattern where a local `tunnel-client` long-polls
outbound to a provider-hosted tunnel while the private MCP server stays inside
the operator's network.

Without a KOTA-shaped path for this pattern, operators who want cloud-hosted
agent surfaces such as Codex, ChatGPT connectors, or Responses API flows to use
private KOTA or internal MCP tools must hand-roll provider-specific runbooks or
expose internal MCP servers publicly.

## Desired Outcome

KOTA has a module-owned private MCP tunnel connector path that maps provider
tunnel profiles onto the existing MCP server/client/setup primitives. Operators
can configure a private MCP server plus outbound tunnel metadata without adding
a parallel capability registry or bypassing setup/secret handling.

## Constraints

- Keep this in the existing MCP/module/setup boundary: `mcp-server` owns KOTA as
  an MCP server, `mcp-registry` owns metadata import, setup requirements own
  tunnel credentials/prerequisites, and core MCP manager keeps consuming strict
  `mcpServers` config.
- Do not implement a general proxy. Only support explicitly configured tunnel
  targets and preserve bounded request/response behavior.
- Keep provider-specific fields behind a module-owned adapter. OpenAI Secure
  MCP Tunnel is the source signal, not a reason to bake OpenAI tunnel concepts
  into core.
- Treat runtime API keys, tunnel ids, workspace/org association, mTLS material,
  and local admin UI exposure as setup/security concerns; do not expose raw
  secrets to agents or task files.

## Done When

- A private MCP tunnel profile can be declared through KOTA setup/config and
  resolves into an existing MCP server/client connection path without requiring
  a public MCP endpoint.
- The implementation validates tunnel profile shape, secret references, and
  target allowlists at the boundary with focused tests.
- Operator-facing diagnostics distinguish missing tunnel credentials,
  unreachable private MCP server, missing workspace/org association, and tunnel
  client health failures.
- Docs/local instructions in the owning module describe the boundary without
  duplicating provider command inventories.

## Source / Intent

Created from the 2026-06-19 peer product benchmark matrix for
`task-add-peer-agent-product-benchmark-matrix`.

Primary source:
https://developers.openai.com/api/docs/guides/secure-mcp-tunnels

## Initiative

Private agent-tool connectivity without public ingress.

## Acceptance Evidence

- Focused tests for tunnel profile decoding, secret-reference validation, target
  allowlisting, and diagnostic mapping.
- A CLI or setup transcript in the run artifact showing a private MCP tunnel
  profile being inspected without printing secrets.
