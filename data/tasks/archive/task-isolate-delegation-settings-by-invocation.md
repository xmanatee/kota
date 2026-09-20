---
status: done
---

# Keep delegated execution bound to its owning session and invocation

## Observed defect

The September 18 role audit traced `loop-constructor.ts` and `loop-init.ts` into
`setDelegateConfig()`: every session replaces one process-global object in
`core/tools/delegate-config.ts`. `runDelegate()` reads that object later.
Creating session B before session A delegates can therefore make A use B's model
client, provider selection, instruction context, transport, MCP manager or budget.
Async MCP initialization can also copy settings from another session through
`getDelegateConfig()`. This is a code-level ownership defect; production data
exposure has not been established.

Named handoffs have an invocation-local `HandoffAgentRuntime`, but fall back to
the same global configuration outside that wrapper. Generic delegate uses that
runtime only for token budget. Delegate execution also pins `xhigh` rather than
receiving resolved caller reasoning. Inspect all maintained invocation boundaries,
including interactive sessions, workflow steps, inbound agent triggers and nested
handoffs; do not repair only the builder or a single backend.

## Required outcome

- Resolve child configuration from its actual parent invocation and session.
  Concurrent sessions cannot borrow another session's client, provider credentials,
  model/effort, prompt, MCP capabilities, transport, accounting or child budget.
- Reuse the existing invocation context and session lifecycle owners. Consolidate
  generic delegation and named handoff configuration where they share behavior;
  remove the mutable global production path and its asynchronous reinitialization
  workaround. Direct callers supply explicit configuration, not a guessed session.
- Preserve mode-specific prompts, actual registered tool selection, parent
  permission/write boundaries, continuation identity and cancellation propagation.
  Native adapters remain responsible for their tool schemas and sandbox policy.
- Verify two interleaved real session boundaries using distinct model/tool ports,
  including delayed initialization and nested execution. Assert observed routing,
  instructions, outputs and teardown, not singleton or private map shape. Reuse
  existing delegate/session tests; no new registry, backend or test matrix per role.

The same audit already corrects harness mode/template selection, the hard-coded
Claude tool catalog and read-only native write scope in the delegation owner.
Preserve those corrections; this task addresses the separate configuration owner.

## Outcome

Delegation configuration now belongs to each session and effective harness
invocation. Generic delegates and named handoffs share that context; direct
callers supply an explicit runtime. The mutable global settings and asynchronous
MCP reinitialization workaround are removed. Nested harness calls inherit their
immediate parent's model, effort, provider and token ledger. Existing tool
selection, native sandbox ownership and continuity remain with their owners.

Validation includes two interleaved real sessions with delayed MCP initialization,
nested calls, distinct instructions and model/tool ports, accounting and teardown;
named-to-generic child settings and budget inheritance; and hosted/native
cancellation. All 82 tests in the 18 affected files passed. The broader scoped
run passed 579 tests, with five additional suites prevented by this execution
sandbox's host-path/network restrictions. Static checks and production build
passed. No live provider or deployment claims are made.

Hosted children also retain the invocation's explicit MCP server declarations
and scope-discovery policy. Their permitted tool catalog includes the owning
tool invocation's discovered MCP tools, still filtered by parent tool limits.
A real hosted-adapter regression verifies two overlapping invocations execute
their own remote lookups, deny excluded tools, suppress planted scope MCP
configuration and close their connections independently. Named handoff tests
verify declarations and discovery policy survive the named-to-generic boundary.
The repair passed 156 tests across 31 owner/protocol/resilience files, the static
gate and production build. Two additional integration failures reproduce against
original HEAD source; they are not claimed passing.
