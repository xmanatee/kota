---
status: done
---

# Isolate MCP manager behavior

## Scope / Starting Points

Inventory `src/core/mcp/manager*`, `src/modules/mcp-registry`, manager fixtures, embedded servers, transport/OAuth/pagination cases, refresh, routing, caches, task resume, and multi-server behavior.

## Required Changes

- Define a narrow injected MCP client port exposing only manager-required operations and events.
- Keep registry, server selection, routing, refresh, cache coordination, task resume, and multi-server composition in the manager.
- Move payload decoding, framing, OAuth, pagination, and transport failure matrices to protocol/client ownership.
- Delete embedded protocol servers, HTTP recorders, copied initialization, and client-owned scenarios from manager suites.

## Must Not Complete While

Any manager scenario is unclassified, any manager test boots a protocol peer for client-owned behavior, or any client protocol branch remains copied in the manager.

## Done When

The scenario inventory has zero unresolved rows and manager suites exercise only manager-owned decisions through the narrow port.

## Acceptance Evidence

Provide the manager/scenario/disposition matrix, port surface, and before/after production, executable-test, and authored-support LOC.

## Completion Evidence

### Client port

`McpManagerClient` is the manager's only client dependency. Its surface is:

- lifecycle and identity: `connect`, `close`, `isConnected`, `getName`, and
  `getCacheAuthorizationContextKey`;
- negotiated capabilities: `supportsTools`, `supportsResources`,
  `supportsPrompts`, and `supportsTasks`;
- catalog invalidation events: `onToolListChanged`, `onResourceListChanged`,
  and `onPromptListChanged`;
- decoded operations: `listTools`, `callTool`, `listResources`,
  `listResourceTemplates`, `readResource`, `listRemoteSkills`,
  `readRemoteSkill`, `listPrompts`, `getPrompt`, `getTask`, `updateTask`, and
  `cancelTask`.

The factory accepts only the normalized transport plus manager-selected
elicitation, task, and authorization options. Page operations, cursors,
framing, transport/OAuth details, and payload decoders are absent from the
port. Completed remote-task results are decoded by the client before either
`callTool` or `getTask` returns; nested task results are rejected there.

### Scenario disposition

The original `manager.test.ts` scenarios are numbered 1–66 in their original
declaration order. Every scenario has a resolved owner and disposition:

| Original scenarios | Family | Owner | Disposition and current proof |
| --- | --- | --- | --- |
| 1–6 | Namespace creation and parsing | Manager registry | Consolidated into injectivity, invalid-suffix, and route-collision cases in `tool-namespace.test.ts`. |
| 7–12, 15, 65–66 | Empty state, unknown routes, missing/invalid config, idempotent close | Manager | Consolidated into `stays empty, rejects unknown routes, and closes idempotently`; config decoding remains owned by the strict config boundary. |
| 13, 17, 64 | Successful, failed, and mixed multi-server initialization | Manager | Consolidated into `keeps successful servers when another connection fails` and multi-server composition through injected clients. |
| 14, 18 | Peer/stdio diagnostic redaction | Client transport | Moved to client connection diagnostics and `stdio-stderr-redaction.test.ts`; manager receives sanitized errors from the port. |
| 16 | Elicitation capability selection | Manager | Retained in `normalizes config and supplies only manager-selected client options to the port`. |
| 19, 29–34 | HTTP routing, authorization challenges, OAuth variants, and secret redaction | Client transport/authorization | Moved to the Streamable HTTP, OAuth policy, client-credentials, private-key JWT, and redaction cases in the client-owned suites. |
| 20–22 | Task polling, persistence, successful restart resume, and unmatched resume | Manager | Retained as three fake-port cases covering persist/update/poll/clear, matching persisted resume, and safe unmatched diagnostics. |
| 23–24, 26 | Task negotiation, task payload/error decoding, and secret-safe failures | Client protocol | Moved to client task lifecycle/rejection tests; the manager consumes typed or sanitized port outcomes. |
| 25, 27 | Terminal/TTL task outcomes and abort cancellation | Manager | Consolidated into the typed remote-task state machine and its manager port scenario; status variants share one terminal error mapping and cancellation uses the same injected task port. |
| 28, 45 | List-change and progress side channels | Split | Client notification/progress dispatch is client-owned; manager refresh selection and result-preserving routing remain in manager fake-port tests. |
| 35–37 | Resource, prompt, and skill operation exposure/provenance | Split | Client decoding/provenance is exercised in client resource/skill cases; capability-backed namespaced exposure and skill invalidation remain in manager tests. |
| 38–39 | Catalog TTL reuse and targeted invalidation | Manager cache | Retained as complete-catalog cache reuse and matching event invalidation through the port. |
| 40 | Resource/prompt additional-input payloads | Client protocol plus manager routing | Payload variants are client-decoded; manager resolver routing is represented once by the injected additional-input case. |
| 41–42 | Resource/prompt-only HTTP and stdio peers | Client negotiation | Removed from manager; capability-backed operation exposure is tested with injected capability flags, while transport negotiation stays in client tests. |
| 43–44 | Ambiguous and malformed transport config | Manager selection/config boundary | Retained in `rejects malformed server selection before constructing a client`. |
| 46 | Invalid header annotations mixed with valid tools | Client tool decoder | Moved to client schema/header decoding; no invalid declaration crosses the port. |
| 47 | Multi-page `tools/list` | Client pagination | Owned by client aggregation; manager receives a complete tool catalog. |
| 48–49 | Targeted refresh, stale-route removal, and last-known-good fallback | Manager | Consolidated into `refreshes only the notifying server and preserves its last-known-good registry on failure`. |
| 50–52 | Output-schema propagation and result validation | Split | Client preserves decoded schemas/results; manager publication and declaration-bound output validation remain in manager tests. |
| 53–54 | Disconnected routing and rich result preservation | Manager | Retained in disconnected-route and declaration-bound execution cases using typed client results. |
| 55–63 | `input_required` protocol shapes, sampling diagnostics, retry/decline/unavailable paths | Split | Shape decoding and malformed variants moved to client tests; one manager fake-port case proves resolver/progress routing without copying the protocol matrix. |

Client pagination has explicit public-API proof: `listResources()` follows a
`nextCursor`, combines both pages and their cache hints, and rejects a repeated
cursor. Pagination is not referenced by manager production or tests.

Unresolved scenarios: **0**.

### LOC comparison

Physical LOC were measured from `HEAD` and this completed worktree. The scope is
the manager-owned surface under `src/core/mcp`: production is `manager*.ts`
excluding tests/support, executable tests are `manager*.test.ts`, and authored
support is `manager-test-support.ts`.

| Surface | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Production | 2,478 | 2,436 | -42 |
| Executable manager tests | 5,481 | 557 | -4,924 |
| Authored manager test support | 0 | 237 | +237 |

The executable-test reduction removes embedded peers, HTTP recorders, copied
initialization, and protocol matrices from manager ownership. The authored
support increase is the single typed fake implementing the injected port.

## Initiative

Child of `task-redesign-mcp-test-ownership`.
