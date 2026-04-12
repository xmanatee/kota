---
id: task-mcp-server-test-coverage
title: Add test coverage for mcp-server module
status: done
priority: p2
area: modules
summary: The mcp-server module exposes KOTA tools to external MCP clients but has zero tests. As an external-facing protocol boundary, it needs coverage for tool registration, invocation routing, and error handling.
created_at: 2026-04-12T01:10:00Z
updated_at: 2026-04-12T05:27:14.043Z
---

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
