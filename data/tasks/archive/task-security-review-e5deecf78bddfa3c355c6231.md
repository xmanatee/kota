---
status: done
---
# Security review: Catalog operations accumulate entries and unique cursors until the peer omits nextCursor, with no aggregate resource bound. A malicious peer can therefore keep initialization or enumeration pending and grow retained memory despite individual request timeouts and response limits. A controlled production-client probe accepted 2,048 continuing pages and attempted another; only the synthetic peer's deliberate failure ended traversal. Memory exhaustion itself was not attempted.

security family: e5deecf78bddfa3c355c6231e61f251d1348914c514269e37b6b0ccfd8a4ab20


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-operations.ts
claim:

> Catalog operations accumulate entries and unique cursors until the peer omits nextCursor, with no aggregate resource bound. A malicious peer can therefore keep initialization or enumeration pending and grow retained memory despite individual request timeouts and response limits. A controlled production-client probe accepted 2,048 continuing pages and attempted another; only the synthetic peer's deliberate failure ended traversal. Memory exhaustion itself was not attempted.

## Desired Outcome

> Give complete catalog traversal an aggregate resource budget and cancellation/deadline handling at the client operation owner. Apply it consistently to tools, resources, resource templates, and prompts, rejecting excessive traversal before retaining further pages. Per-response byte limits and repeated-cursor rejection must remain in place.

> Bound aggregate catalog traversal and verify termination against continuously unique cursors while preserving legitimate pagination. Keep this separate from the completed per-response-body repair: bounded individual responses do not bound the retained catalog. The run artifact mcp-boundary-probes.json records the controlled traversal.

## Constraints

- Resolve every retained variant at the common owner; preserve distinct exploit preconditions and regression obligations.
- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-13T00-35-54-058Z-security-review-2o6hi1.

Confirmed by security-review workflow runs:

- 2026-09-13T00-35-54-058Z-security-review-2o6hi1

security evidence: 2c70ce45b5780e439ad91b3e7cb1fd9fe847eeacdfae0911da47daa6e4103a70
evidence identity: mcp-unique-cursor-unbounded-catalog-v1
production owner: src/core/mcp/client-operations
violated invariant: bounded-remote-catalog-aggregation
Common repair:
> Give complete catalog traversal an aggregate resource budget and cancellation/deadline handling at the client operation owner. Apply it consistently to tools, resources, resource templates, and prompts, rejecting excessive traversal before retaining further pages. Per-response byte limits and repeated-cursor rejection must remain in place.
Exploit preconditions:
> An attacker controls a configured HTTP MCP peer and returns valid catalog pages below individual response limits, each with a new nextCursor. Tool enumeration is reached during manager initialization; the other variants require their corresponding catalog operation. The peer must continue supplying timely responses.
finding id: mcp-catalog-pagination-unbounded-accumulation
candidate id: mcp-transport:src/core/mcp/client-operations.ts:1
verdict: confirmed
rationale:

> All four catalog traversals retain unique cursors and accumulate entries without an aggregate budget or traversal deadline. Independent public-client probes accepted 2,048 continuing pages each for tools, resources, resource templates and prompts, attempting another request until the synthetic peer deliberately failed. Manager initialization awaits complete tool enumeration. A configured malicious peer supplying timely unique-cursor pages can keep enumeration pending and grow retained memory. Memory exhaustion was not attempted. A common aggregate traversal budget addresses these variants; the completed per-response-body repair protects a distinct invariant and does not bound catalog accumulation.

Evidence:

Evidence 1:



path: src/core/mcp/client-operations.ts

line: 96

excerpt:



> do {
>       const page = await this.listToolsPage(cursor);
>       tools.push(...page.tools);
>       cursor = page.nextCursor;

Evidence 2:



path: src/core/mcp/client-operations.ts

line: 100

excerpt:



> if (cursor !== undefined) {
>         if (seenCursors.has(cursor)) {
>           throw new Error(
>             `Malformed MCP tools/list result from server "${this.serverName}": repeated nextCursor`,
>           );
>         }
>         seenCursors.add(cursor);
>       }
>     } while (cursor !== undefined);

Evidence 3:



path: src/core/mcp/client-operations.ts

line: 218

excerpt:



> prompts.push(...page.prompts);
>       cacheHints.push(page.cache);
>       cursor = page.nextCursor;

Evidence 4:



path: src/core/mcp/manager.ts

line: 200

excerpt:



> const tools = client.supportsTools() ? await client.listTools() : [];
>           this.registry.replaceServerTools(name, client, tools);


## Resolution and verification

The common client-operation owner now bounds complete tools, resources,
resource-template and prompt traversal to 128 pages, 10,000 entries, 16 MiB of
aggregate serialized UTF-8 result data and a 30-second deadline. Byte accounting
includes cursors, rejected definitions and metadata and runs before decoding or
retaining each page. The entry limit is checked before appending entries;
continuing peers receive no request beyond the page limit. Existing response-body
limits and repeated-cursor rejection remain in place.

Whole-traversal cancellation propagates to HTTP requests and removes pending
stdio requests. A monotonic elapsed-time check also enforces the deadline when
rapid responses postpone timer callbacks. Failed tool traversals preserve the
previous complete tool-header settings rather than publishing a partial catalog.

Verification in builder run `2026-09-13T07-40-11-607Z-builder-ht2oi6`:

- `pnpm test:protocol src/core/mcp`: 90 tests passed in eight files. The 35 new
  public-client cases cover every catalog's continuous unique-cursor termination,
  valid boundary pagination, aggregate entries and UTF-8 cursor bytes, repeated
  cursors, pre-cancellation and cancellation/deadline during response streaming.
  They also exercise late stdio replies, fresh traversal after cancellation,
  elapsed-time enforcement and preservation of tool-header settings. Existing
  transport, response-body, authorization and diagnostic security cases passed.
  The former single resources repeated-cursor case was replaced by the shared
  four-catalog coverage.
- `pnpm test:owner src/core/mcp/manager`: 17 tests passed in two files, checking
  initialization failure isolation, refresh retention and catalog consumers.
- `pnpm check:fast` passed during implementation, covering production/test types,
  lint, task validation, generated client bindings and module admission. Final
  static verification is recorded in the run's `check-fast.log`.
- Final source inspection confirms all four complete-list consumers use the
  common traversal owner; `git diff --check` passed for changed source/config.

The byte limit bounds serialized result data, not exact JavaScript heap usage.
Tests use synthetic HTTP peers, controlled clocks and a real stdio subprocess;
no memory-exhaustion attempt, live remote service or deployment claim is made.
