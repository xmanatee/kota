---
status: done
---

# Reduce MCP server and interoperability duplication

## Scope / Starting Points

Inventory `src/modules/mcp-server`, server handlers, stdio and Streamable HTTP hosts, generic dispatch tests, method-specific semantics, authentication/limits, and client/server integration matrices.

## Required Changes

- Keep server handlers focused on method-specific tools, resources, prompts, sampling, tasks, and authorization semantics.
- Remove generic dispatch, codec, framing, pagination, and client-policy copies already owned in core MCP.
- Retain one real client/server interoperability matrix spanning stdio and Streamable HTTP plus explicit authentication, redaction, and message-limit boundaries.
- Delete overlapping mock integrations and bespoke peers after the real matrix owns their distinct risk.

## Must Not Complete While

Any server scenario is unclassified, any generic protocol matrix remains copied, or the retained interoperability path mocks away the transport boundary.

## Done When

The scenario inventory has zero unresolved rows and every retained server/interoperability scenario names a method, transport, or security failure unique to this layer.

## Acceptance Evidence

Provide the handler/scenario/disposition matrix, real transport matrix, and combined MCP before/after executable-test and authored-support LOC.

## Completion Evidence

### Handler / scenario / disposition matrix

| Scenario family | Production owner | Disposition and unique retained failure |
| --- | --- | --- |
| Initialize, discovery, revision negotiation, and request metadata | `mcp-handlers-initialize.ts` plus `mcp-protocol-types.ts` | Consolidated into handler negotiation/rejection cases derived from the production capability builder; protocol decoder variants remain in `mcp-protocol-types.test.ts`. |
| Tool projection, filtering, calls, complete results, and output schemas | `mcp-handlers-tools.ts` | Consolidated into one method-level projection/call case and the production client/server matrix; copied list/call wire matrices were removed. |
| Official and legacy task lifecycle | `mcp-handlers-tasks.ts` plus `McpTaskStore` | One async handler journey proves negotiated tool task creation and terminal retrieval; transition, expiry, cancellation, settlement, and cursor decisions remain with the store tests. |
| Resources, skills, Apps, memory, knowledge, and root-scoped reads | `mcp-handlers-resources.ts`, `resources.ts`, and `mcp-mrtr.ts` | One resource list/read/error handler journey drives the production MRTR roots request, rejects request-state reuse with changed parameters, and proves the returned root scopes content. Typed decoders retain malformed-shape decisions; generic cursor permutations were removed. |
| Prompt discovery, validation, and rendering | `mcp-handlers-prompts.ts` plus `prompts.ts` | One built-in/project catalog and rendering journey retains missing-variable rejection and proves a project prompt is rendered from the root returned through MRTR; generic pagination copies were removed. |
| Resource/list-change/task-status subscriptions | `mcp-handlers-resources.ts` and `streamable-http.ts` | One server event-routing case plus transport-owned live SSE cases remain; subscribe/unsubscribe permutations and duplicate capability assertions were removed. |
| Elicitation and multi-round-trip retry shapes | `mcp-handlers-elicitation.ts`, `mcp-mrtr.ts`, and tool/task handlers | One task-owned input-required journey rejects a stale request state, resumes through `tasks/update`, and observes the completed tool result. Typed suites retain form/URL and store lifecycle variants; repeated accept/decline/cancel route matrices were removed. |
| Sampling | `mcp-handlers-sampling.ts` | One legacy forwarding case and one modern-revision rejection share a single model double. |
| Completion | `mcp-handlers-completion.ts` | One production-catalog completion plus unknown-argument rejection remains; repeated filtering/catalog permutations were removed. |
| JSON-RPC codec, ids, dispatch, stdio framing, and HTTP client policy | Core MCP client protocol/transport | Removed from server handler tests. The real interoperability matrix now owns cross-boundary framing; core client tests retain only client-owned adversarial limits and policy. |
| HTTP headers, origin, authorization, streaming, and unavailable methods | `streamable-http.ts` | Retained only in the transport suite where the HTTP status/header/SSE effect is the oracle; the duplicated discover/list/call handler integration was removed. |
| Server Card and registry publication metadata | `server-card.ts` and `registry-metadata.ts` | Retained in their focused suites; the HTTP adapter keeps only the well-known-route dispatch/security boundary. |

Unresolved scenario families: **0**. The original 177-case server file is now 11 cohesive method-handler cases; the 16-case HTTP adapter file is 14 transport/security cases.

### Real transport matrix

| Transport | Real boundary | Retained oracle | Unique boundary failure |
| --- | --- | --- | --- |
| stdio | `McpClient` spawns a child process running the production `McpServer`; newline JSON-RPC crosses OS pipes. | Connect, list the production fixture tool, call it, and decode its complete structured result. | Process lifecycle and stdio framing cannot be mocked away. |
| Streamable HTTP | `startMcpStreamableHttpServer` opens a loopback TCP listener and the production `McpClient` uses `fetch`. | Connect, discover, list, call, and decode the same tool as stdio. | HTTP request/response framing and headers cross a real socket. |
| Streamable HTTP authorization/redaction | The same real listener runs the production bearer verifier. | Invalid credentials fail without appearing in the client error; a valid scoped bearer reaches the tool catalog. | Authentication admission and credential redaction. |
| Streamable HTTP message limit | A production server tool returns a response larger than `MCP_HTTP_RESPONSE_BODY_MAX_BYTES`. | The production client rejects the real streamed response at the canonical byte limit. | Oversized message rejection across the actual transport. |

The stdio row executes in the restricted native-agent sandbox. This sandbox denies loopback `listen(2)` with `EPERM`, so the three HTTP-listener rows are typechecked here and execute in the protocol portfolio where loopback sockets are available. The sandbox-safe direct HTTP adapter suite covers the same header, origin, authorization, and SSE decisions without claiming to replace the real matrix.

### Combined MCP LOC

Physical LOC cover all `*.test.ts` and authored `*test-support.ts`, `*test-helpers.ts`, and `*test-fixture.ts` files under `src/core/mcp` and `src/modules/mcp-server`, measured from the admitted `HEAD` and this completed worktree.

| Surface | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Executable MCP tests | 11,448 | 5,627 | -5,821 (-50.8%) |
| Authored MCP test support | 815 | 839 | +24 |

The executable delta is exactly the touched portfolio: `server.test.ts` 6,338 → 533, `streamable-http.test.ts` 1,122 → 1,021, `client.test.ts` 1,112 → 1,052, and the new real interoperability matrix 0 → 145. The 24 support lines compose the production stdio server; they do not implement a bespoke peer.

## Initiative

Child of `task-redesign-mcp-test-ownership`.
