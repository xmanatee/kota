---
status: done
---

# Interoperate with stable MCP 2026-07-28 peers

## Problem

The official release page identifies `2026-07-28` as stable, but KOTA's external
MCP client and first-party server accept only `2025-11-25`, `DRAFT-2026-v1` and
`2024-11-05`. A September 13 production-decoder probe of an initialize result
with `protocolVersion: 2026-07-28` throws `Malformed MCP initialize result`;
the server's production version predicate returns false for the same revision.
Peers requiring the released revision cannot negotiate it with KOTA.

The archived `task-support-the-current-mcp-protocol-revision-beside-t` owns the
earlier 2025 stable upgrade. No active task owns this later compatibility gap.

## Outcome And Acceptance

Support the final `2026-07-28` contract through the existing client and server
owners, so a peer using that revision can connect and perform a representative
tool operation in either direction. Read the final versioned specification and
changelog before deciding feature gates; the release announcement proves release
status, not equivalence to KOTA's synthetic draft contract.

Preserve intentional older-peer compatibility and strict rejection of unknown
versions. Align negotiation, HTTP version handling and revision-dependent
capabilities with the final contract across maintained transports. Do not merely
rename the draft constant or advertise features whose final semantics are unmet.
Keep this one interoperability outcome with the existing MCP owners rather than
creating a parallel protocol stack or a task for every specification page.

Verify actual client/server exchanges through their production boundaries,
including a useful tool result, prior-version negotiation and unsupported-version
diagnostics. Retain a representative transcript; source predicates alone do not
establish working interoperability. Use proportionate existing owner/protocol
coverage for affected capability and transport differences.

## Evidence

- https://github.com/modelcontextprotocol/modelcontextprotocol/releases,
  runtime observation `2026-09-13T11:24:22.377Z`, fingerprint
  `sha256:bb544817036008ff589d06c7cb0be6fd`, identifies the stable release and links
  https://modelcontextprotocol.io/specification/2026-07-28 and its `/changelog`.
  The linked final text was not read in this discovery pass.
- Explorer run `2026-09-13T01-25-22-195Z-explorer-ivm5rm` executed
  `decodeInitializeResult` from `src/core/mcp/client-initialize-decoders.ts`
  and `isMcpProtocolVersion` from
  `src/modules/mcp-server/mcp-protocol-types.ts`. The former rejects the released
  revision; the latter excludes it. This was a local boundary probe, not a live
  peer exchange. The run summary retains the output and source provenance.

## Completion

Implemented by builder run `2026-09-13T12-15-26-827Z-builder-inxnff` (admitted
priority p2). The client and server now implement released stateless discovery,
request metadata, result envelopes, HTTP routing headers and version errors.
Representative tools work over stdio and the production HTTP handler. Existing
older-peer paths remain available; unreconciled draft task and skill extensions
are disabled for the released revision. Structured JSON output, including scalar
and null values, survives the shared tool/message pipeline. Released schemas use
offline JSON Schema 2020-12 validation, including server input/output enforcement.

Read the final versioned specification and changelog, including basic messages,
versioning, stdio and Streamable HTTP, discovery, tools, MRTR and subscriptions,
and the versioned schema. These establish the stateless contract rather than
assuming draft equivalence:
- https://modelcontextprotocol.io/specification/2026-07-28/changelog
- https://modelcontextprotocol.io/specification/2026-07-28/basic
- https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
- https://modelcontextprotocol.io/specification/2026-07-28/transports/streamable-http
- https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts

Run artifacts retain `mcp-transcript.jsonl`, its executable probe, validation logs,
and the build summary. The transcript includes real stdio exchanges, a useful
HTTP result, legacy initialization and unsupported-version diagnostics. HTTP
network calls are replaced at the fetch port with the production handler because
this sandbox denies listeners; three real-listener cases remain skipped. The
read-only dependency directory required a byte-matched verification copy with the
declared Ajv dependency resolved from the installed package. Static checks,
build, schema owner tests and protocol tests validate that copy; runtime owns
normal dependency installation and publication.

The critic's two resource findings were repaired in the same run. Subscription
acknowledgements, update routing and cancellation now retain the original numeric
or string request ID, including distinct concurrent 12 and "12" subscriptions.
Released resource reads map missing resources to -32602 (HTTP 400); prior
revisions retain -32002. The repair protocol suite passed 147 tests with the same
three listener skips; static checks and production build passed. A separate
22-message production dispatch/HTTP probe is retained as
repair-resource-transcript.jsonl, including cancellation isolation and zero IDs.

The subsequent MRTR review finding is also repaired: released clients echo an
empty opaque requestState unchanged for tool, resource and prompt retries. Three
production-client regression cases reproduced the rejection before the fix and
now complete with fresh request IDs. The protocol suite passed 150 tests with
three listener skips, and final static checks/build passed. The run retains the
14-message repair2-mrtr-transcript.jsonl and its executable probe; prior-revision
non-empty retry requirements and server-owned signed-state validation remain
unchanged.

The normal agent tool runner now selects input validation from the remote tool's
negotiated protocol. Released JSON Schema 2020-12 applies before permission hooks
and again after argument rewrites; local tools, synthetic MCP operations and
older peers retain their existing validator. Two production manager/client/runner
regressions cover released and prior peers, valid calls, invalid arguments and
approval rewrites. The selected owner suite passed 41 tests; static checks and
production build passed. The run's repair3-agent-transcript.jsonl records the
critic's exact patternProperties schema: two useful calls reached the peer and
three invalid calls were rejected locally. Verification used the same sandboxed,
byte-matched dependency copy; this is a scripted peer exchange, not live external
service evidence.

Dynamic OAuth registration now supplies application_type: native for HTTP
loopback callbacks and web for HTTPS callbacks. This shared authorization step
precedes MCP version negotiation. Production-client cases for IPv4/IPv6 loopback
and HTTPS callbacks reproduce registration rejection without the field and now
complete authorization and a useful released tool call. All 62 selected protocol
tests passed; corrected test-fixture typing also passed focused tests, static
checks and the production build. The run retains repair4-oauth-transcript.jsonl,
a 16-record scripted-peer exchange through the production authorization path.
The existing dependency-copy and broader-suite limitations remain documented.

HTTP subscriptions now own distinct delivery callbacks and cleanup handles even
when independent clients reuse a request ID. Wire IDs remain unchanged in
acknowledgements and updates. The global request-ID sink registry is removed;
resource, catalog, prompt and task notifications use the owning subscription's
delivery callback. Stdio cancellation retains its connection-local ID behavior.
Released and draft HTTP regression cases now demonstrate independent delivery,
closure and idempotent cleanup for duplicate numeric IDs, string IDs and zero.
The selected protocol suite passed 92 tests with three existing listener skips;
final server/HTTP tests passed 30 tests, static checks and build passed. A
10-record production HTTP-handler probe is saved as
repair5-subscription-transcript.jsonl. Existing verification-copy and broader
suite limitations remain documented in the run summary.

HTTP progress now belongs to the decoded invocation, so overlapping calls with
identical wire IDs or tokens retain independent progress and completion cleanup.
HTTP stream closure clears only its invocation through an AbortSignal. Stdio
retains connection-local token checks and exact numeric/string ID cancellation;
an old cancelled invocation cannot clear a newer owner. Three HTTP concurrency
cases and a real stdio exchange cover these distinctions. All 96 selected
protocol tests passed (three existing listener skips), as did check:fast and the
production build. The 17-record repair6-progress-transcript.jsonl exercises the
production HTTP handler with overlapping ID 1 calls and successful token reuse.
Verification used the byte-matched dependency copy under the same sandbox;
previous broader-suite limitations remain in the run summary.

HTTP progress/logging responses now defer status commitment until dispatch emits
its first output. Protocol failures remain ordinary HTTP 400/404 errors; valid
output buffers until the stream attaches, preserving progress and closure
isolation. Regression cases reproduce and repair the prior HTTP 200 responses
for unsupported methods and missing clientCapabilities with streaming metadata.
All 99 selected protocol tests passed (three existing listener skips), together
with check:fast and the production build. The 29-record
repair7-http-transcript.jsonl verifies the error statuses and subsequent
concurrent progress/token reuse through the production HTTP handler. Existing
verification-copy and broader-suite limitations remain in the run summary.

The confirm tool now resolves input-required negotiation before logging or
progress, so missing form elicitation support returns HTTP 400/-32021 even when
streaming metadata is present. Supported clients still receive input_required
and complete confirmation with the bound requestState. Regression tests reproduce
the earlier HTTP 200 error and cover both rejection and successful resumption.
All 102 selected protocol tests passed (three existing listener skips), as did
check:fast and the build. The 18-record repair8-confirm-transcript.jsonl probes
these outcomes through the production HTTP handler using the real confirm tool.
Existing dependency-copy and broader-suite limitations remain documented.

Offline JSON Schema compilation and validation now run under V8 execution
deadlines, in addition to serialized node/depth limits. This interrupts repeated
reference expansion and pathological regular expressions; exceeded budgets fail
with a diagnostic. The production manager probe admits the critic's 28-level
reference schema, rejects its expensive output in approximately 53 ms and then
successfully handles another call. The 11-record repair9-schema-transcript.jsonl
retains that scripted-peer exchange. Eleven schema/tool-runner owner tests and
102 protocol tests passed (three existing listener skips), together with static
checks and build. Complex schemas can now fail when they exceed the work limit;
existing dependency-copy and broader-suite limitations remain documented.
