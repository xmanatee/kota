# Scope authority structure

The sole production persistence boundary for directory-scope trust and policy is
`ScopeAuthorityStore`, invoked by `ScopeAuthorityService` after a verified
machine-local operator action. One atomic authority document owns revision,
trust, policy fragments, and audit entries.

Production readers converge on that document:

- configuration loading strips machine-authority keys from project and caller
  input, then overlays the global machine-owned decision;
- the daemon runtime resolves scope policy from the live authority service;
- workflow and interactive agent paths receive that resolved policy through the
  neutral harness contract;
- shared tool execution enforces the resolved policy, while opaque process
  execution is isolated from the authority document and operator capability;
- setup and daemon control clients query the same live scope authority state.

The operator mutation route requires daemon control authentication plus a
one-time machine-authority challenge. The reusable operator credential never
crosses the selected transport: it verifies the daemon's challenge proof and
signs the exact scope, action, body, and challenge. The daemon consumes that
proof once to create an unforgeable action capability, so project files,
workflow output, agent text, generic daemon clients, endpoint impersonators,
and prototype-shaped lookalikes cannot authorize another mutation.
