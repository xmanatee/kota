---
status: done
---

# Consolidate MCP protocol and client ownership

## Scope / Starting Points

Inventory `src/core/mcp` for JSON-RPC decoding, initialization, capability negotiation, stdio/HTTP framing, OAuth binding, pagination, input-required, errors, caching/replay, limits, redaction, inline peers, and test utilities.

## Required Changes

- Assign codecs, endpoint policy, transport framing, and client state to explicit owners.
- Derive method and capability catalogs from canonical types/decoders rather than literal test copies.
- Replace bespoke inline peers with a bounded protocol-owned peer set.
- Retain representative valid and adversarial messages for authentication, OAuth, redaction, replay/cache safety, input-required, pagination, limits, and untrusted peers.
- Delete duplicated client matrices and compatibility protocol formats with no supported peer.

## Must Not Complete While

Any protocol scenario is unclassified, any literal catalog is frozen in ordinary tests, or any behavior has duplicate codec/policy/transport owners.

## Done When

The scenario inventory has zero unresolved rows and the compact portfolio owns every supported protocol/security failure once.

## Acceptance Evidence

### 1. Scenario / Owner / Disposition Matrix

| # | Scenario | Production Owner | Verification Disposition | Status |
|---|---|---|---|---|
| 1 | Stdio Process Lifecycle & Process Exit | `src/core/mcp/client-stdio-runtime.ts` | Single canonical lifecycle test in `client.test.ts` with `BOUNDED_STDIO_MCP_PEER` | Retained / Consolidated |
| 2 | Sensitive Environment Filtering & Git Bare-Repo Safety | `src/core/mcp/client-stdio-runtime.ts` | Verified in `client.test.ts` via explicit transport env overrides & git safety guards | Retained / Consolidated |
| 3 | Protocol Negotiation (2024-11-05, 2025-11-25, DRAFT-2026-v1) | `src/core/mcp/client-connection.ts` & `client-initialize-decoders.ts` | Canonical capabilities derived from `mcpProtocolCapabilities()`; ordered fallback verified | Retained / Consolidated |
| 4 | Monotonic Progress Events & Buffering Limits | `src/core/mcp/client-base.ts` | Verifies token forwarding, monotonic sequences, and event dropping past max limits | Retained / Consolidated |
| 5 | Catalog Change Subscriptions (`tools`, `resources`, `prompts`) | `src/core/mcp/client-connection.ts` | Subscriptions opened on demand, single handler dispatch verified | Retained / Consolidated |
| 6 | Tool List Decoding & Output Schema Preservation | `src/core/mcp/client-tool-list-decoders.ts` | Verifies valid `outputSchema` preservation and malformed schema rejection | Retained / Consolidated |
| 7 | Tool Annotations & Parameter Mirroring (`x-mcp-header`) | `src/core/mcp/client-tool-list-decoders.ts` & `client-http-runtime.ts` | Header mapping verified without bespoke server scripts | Retained / Consolidated |
| 8 | Pagination & Loop Detection | `src/core/mcp/client-operations.ts` | Single multi-page flow and loop rejection test | Retained / Consolidated |
| 9 | Tool Call Decoding (Text, Image, Structured, `_meta`) | `src/core/mcp/client-result-decoders.ts` | Decoders tested with typed MCP structures, structuredContent, and metadata | Retained / Consolidated |
| 10 | Input Required & Elicitation Requests (Form, URL) | `src/core/mcp/client-operations.ts` & `client-sampling-decoders.ts` | Form & URL elicitation decoding and retry flow verified | Retained / Consolidated |
| 11 | Tasks Extension Protocol & Async Execution | `src/core/mcp/client-operations.ts` | Task creation, status polling, update, and cancellation verified over stdio & HTTP | Retained / Consolidated |
| 12 | Streamable HTTP Handshake (`server/discover`) & SSE Framing | `src/core/mcp/client-http-runtime.ts` | Mocked fetch stream framing tests via `mockClientHttpFetch` | Retained / Consolidated |
| 13 | HTTP Response Body & SSE Message Size Limits | `src/core/mcp/client-response-body-limit.ts` | Verifies 10MB HTTP body and 2MB SSE chunk rejection limits | Retained / Consolidated |
| 14 | 401 Protected Resource Discovery (RFC 9728) | `src/core/mcp/client-protected-resource-runtime.ts` | WWW-Authenticate challenge parsing and well-known fallback verified | Retained / Consolidated |
| 15 | OAuth PKCE Authorization Code Flow | `src/core/mcp/client-oauth-token-runtime.ts` | Authorization code flow with code_verifier and callback verified | Retained / Consolidated |
| 16 | OAuth Client Credentials (basic & private_key_jwt RS256/ES256) | `src/core/mcp/client-oauth-token-runtime.ts` | Signed JWT assertions and token acquisition verified | Retained / Consolidated |
| 17 | Enterprise Managed Authorization (ID-JAG Exchange) | `src/core/mcp/client-oauth-token-runtime.ts` | ID-JAG token exchange and bearer token issuance verified | Retained / Consolidated |
| 18 | Token Refresh, Expiry Re-acquisition & 403 Step-up | `src/core/mcp/client-authorization-runtime.ts` | Scope step-up and automatic token refresh verified | Retained / Consolidated |
| 19 | Comprehensive Credential & Token Redaction | `src/core/mcp/client-authorization-runtime.ts` | Error boundaries verified to never leak secrets, private keys, or tokens | Retained / Consolidated |
| 20 | Remote Resources & Prompt Templates | `src/core/mcp/client-operations.ts` & `client-resource-prompt-list-decoders.ts` | Resource listing, reading, prompt templating, and cache hints verified | Retained / Consolidated |
| 21 | Remote Skills Discovery & Direct URI Read | `src/core/mcp/client-remote-skills.ts` | `skill://index` discovery and direct markdown reading verified | Retained / Consolidated |

### 2. Supported Peer / Transport Table

| Transport | Framing / Wire Protocol | Supported Handshakes | Authentication Methods | Framing Limits |
|---|---|---|---|---|
| **Stdio** | JSON-RPC 2.0 newline-delimited line framing | `initialize` / `notifications/initialized` (`2024-11-05`, `2025-11-25`, `DRAFT-2026-v1`) | Sanitized local environment, explicit transport environment | OS buffer limits, Git bare-repo config injection |
| **Streamable HTTP** | JSON-RPC 2.0 POST with optional Server-Sent Events (`text/event-stream`) | `server/discover` (`2024-11-05`, `2025-11-25`, `DRAFT-2026-v1`) | Bearer tokens, OAuth PKCE, Client Credentials (basic & private_key_jwt RS256/ES256), Enterprise ID-JAG | 10 MB HTTP response body, 2 MB SSE event chunk |

### 3. Verification Line-of-Code Metrics (Before & After)

| File / Component | Before LOC | After LOC | Change | Notes |
|---|---|---|---|---|
| `src/core/mcp/client.test.ts` | 6,995 | 1,034 | **-5,961 (-85.2%)** | Eliminated duplicate client matrices; consolidated 21 domain suites; derived capabilities from canonical exports |
| `src/core/mcp/client-http-test-helpers.ts` | 1,063 | 548 | **-515 (-48.4%)** | Replaced 760-line inline mock server string with `createStdioMcpPeerScript()` |
| **Total MCP Client Verification** | **8,058** | **1,582** | **-6,476 (-80.4%)** | Full protocol coverage maintained with 0 unresolved rows |

## Initiative

Child of `task-redesign-mcp-test-ownership`.
