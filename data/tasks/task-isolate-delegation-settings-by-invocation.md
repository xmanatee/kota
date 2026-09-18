---
status: open
priority: p1
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
