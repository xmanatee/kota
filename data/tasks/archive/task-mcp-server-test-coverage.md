---
status: done
---

# Add test coverage for mcp-server module

## Problem

The mcp-server module is the external surface that lets MCP clients (Claude
Desktop, other MCP hosts) invoke KOTA tools. It has no test files. Multiple
MCP feature tasks have been completed (completions, elicitation, resources,
sampling, tool annotations) but the module itself lacks baseline coverage.

External protocol boundaries are high-value test targets because they are where
internal assumptions meet external input. A regression here is invisible until
an external client breaks.

## Desired Outcome

A co-located test file covers: tool registration/discovery, tool invocation
routing, error responses for unknown tools or malformed input, and resource
exposure if applicable. The tests validate the MCP protocol contract without
requiring a live MCP client.

## Constraints

- Mock or stub the underlying KOTA tool runner; do not require a running daemon.
- Follow established test patterns from similar protocol-boundary modules.
- Focus on the MCP protocol contract, not on individual tool implementations.

## Done When

- A `*.test.ts` file exists alongside the module covering the protocol surface.
- All tests pass in CI.
- No production code changes are required solely to support testing.
