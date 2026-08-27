---
status: done
---

# Security review: MCP approval preflight initializes every server from the current project configuration before checking that the approved server's transport identity matches the reviewed identity. A configuration changed after review can therefore launch an unreviewed stdio command during an approval attempt, even though the approval is subsequently rejected.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/approval-queue/approval-execution-preflight.ts
claim:

> MCP approval preflight initializes every server from the current project configuration before checking that the approved server's transport identity matches the reviewed identity. A configuration changed after review can therefore launch an unreviewed stdio command during an approval attempt, even though the approval is subsequently rejected.

## Desired Outcome

> Derive and compare the reviewed server's normalized transport identity directly from configuration before creating connections or subprocesses. Fail closed on mismatch, then initialize only the reviewed server needed for the approved tool. Add regression coverage proving that changed and newly added stdio transports cannot create a marker file or otherwise start during rejected preflight.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-31T14-48-59-674Z-security-review-3gu0xx.

finding id: mcp-approval-preflight-executes-unverified-transport
candidate id: auth-approval-boundary:src/modules/approval-queue/approval-execution-preflight.ts:1
verdict: confirmed
rationale:

> Approval preflight calls McpManager.initialize(config) before comparing the reviewed declaration and transport fingerprints. initialize iterates over every configured MCP server and calls client.connect(); stdio connection immediately spawns the configured command. Consequently, a changed approved-server transport or newly added server can execute during preflight before the mismatch is detected and rejected.

Evidence:

Evidence 1:

path: src/modules/approval-queue/approval-execution-preflight.ts

line: 148

excerpt:

> const mcpManager = new McpManager({ projectDir: cwd });

Evidence 2:

path: src/modules/approval-queue/approval-execution-preflight.ts

line: 150

excerpt:

> await mcpManager.initialize(config);

Evidence 3:

path: src/modules/approval-queue/approval-execution-preflight.ts

line: 194

excerpt:

> const currentTransportIdentity = mcpManager.getToolServerTransportIdentity(item.tool);

Evidence 4:

path: src/core/mcp/manager.ts

line: 606

excerpt:

> const results = await Promise.allSettled(entries.map(async ([name, serverConfig]) => {

Evidence 5:

path: src/core/mcp/manager.ts

line: 624

excerpt:

> await client.connect();

Evidence 6:

path: src/core/mcp/client-stdio-runtime.ts

line: 39

excerpt:

> this.proc = spawn(this.transport.command, this.transport.args ?? [], {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- `src/modules/approval-queue/approval-execution-preflight-security.test.ts`
  proves rejected preflight does not start either a changed reviewed stdio
  transport or a newly added unreviewed stdio transport by asserting their
  process-start marker files remain absent.
- Verification: `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source
  ./node_modules/.bin/vitest run --configLoader runner --silent=true
  <all src/modules/approval-queue tests>` passed (37 files, 149 tests), and the
  equivalent `src/core/mcp` run passed (10 files, 239 tests).
- Verification: `./node_modules/.bin/tsc --noEmit`, the strict-types policy
  integration test, and focused Biome checks all passed. Full `src/` Biome
  exited 0 with pre-existing unused-code warnings outside the touched files.
