---
status: done
---

# Keep module log reads and writes in their authoritative runtime scope

## Confirmed failure

Reproduced on main `0fa8700c8`, September 11, 2026:

1. Initialize `ModuleLogStore` for disposable scope A through
   `initModuleLogStore(A)` and append an `audit-probe` entry with an A sentinel.
2. Call `runModuleFactory({action:"logs", name:"audit-probe"},
   {cwd:B, scopeRoot:B})` for a different disposable scope B.
3. The response contains A's sentinel, despite B being the requested scope.

`src/core/tools/module-factory/index.ts` drops context for `logs`; `logs.ts`
uses `getModuleLogStore()`. Module-context logging also looks up this singleton
on every write. `src/core/daemon/scope-runtime.ts` already creates a log store
per scope but installs the default store globally, leaving other scopes' callers
connected to the default scope's storage.

## Required outcome

Connect log production and queries to the existing scope/runtime ownership.
Remove the global lookup from scoped execution. Define the scope source for
request/session operations and activation diagnostics, preserving the distinction
between canonical `scopeRoot` and an isolated execution `cwd`. Operation logging
already receives an authoritative `scopeId`; loader storage cwd must not replace
that identity. Scope-less diagnostics must not be silently attributed to the
default project.

Use the existing runtime bundle and context seams rather than a second scope
registry or another global map of stores. Preserve log formatting and retention
with their current owner.

## Acceptance

- Two real scoped contexts can interleave writes and `module_factory` queries;
  each returns only its own entries, including the no-name listing action.
- Switching the default scope or tearing down another runtime does not redirect
  a surviving context's logs. Explicit operation scope remains authoritative.
- Missing/retired scope ownership is explicit; it cannot fall back to another
  scope. Validate canonical-scope versus worktree behavior through a real caller.
- Keep the regression with the scope/log owner; remove obsolete singleton
  assertions and guidance that would preserve the defect.

The module-filesystem task owns traversal and symlink confinement inside a
selected store. This task owns scope selection and attribution.

## Completion

Module log writes and `module_factory` queries now select the existing runtime
bundle through a host-bound live scope resolver. Session and workflow calls
carry that resolver; explicit operation scope overrides request scope. Standalone
hosts declare a canonical activation root separately from storage/execution cwd.
Missing, mismatched, retired, and withdrawn runtime ownership never selects a
default scope. Scope-less activation diagnostics remain terminal-only. The global
log-store singleton and its assertions were removed; formatting and retention
remain owned by `ModuleLogStore`.

Verification covers concurrent scoped writes and named/unnamed queries, default
changes, operation attribution, runtime retirement/provider withdrawal, and real
workflow tool calls. The scope/log, factory, MCP, Telegram operation-health,
session, module-loader, and affected workflow/lifecycle suites passed (262 tests
across 18 files). A disposable `module_factory` probe captured the actual rendered
responses for two canonical roots sharing one execution worktree, plus missing
scope rejection, in this run's `module-log-probe.txt`.

Critic repair closed missing propagation through hosted harness projection,
direct workflow agent steps, standalone execution, and classic delegate tool
batches. Hosted loops preserve either explicit host ownership or the enclosing
tool execution's resolver. Standalone execution consults its live provider on
every resolution, including code-step `ctx.runAgentHarness` calls. Three integration
journeys exercise the OpenAI tool adapter through real standalone workflow
execution, with named queries and listings
before and after provider withdrawal while the canonical log files remain.
Removing the harness propagation or standalone resolver makes the affected
journeys fail at the unavailable-ownership assertion. The repair's focused
coverage passed 82 distinct tests across 11 files, including standalone child
completion, failure, and cancellation with only the external listener probe
controlled.

Provider ownership history now lives in the host registry rather than depending
on log traffic. Real module-loader/standalone-host probes load a silent module
before creating the host, then withdraw its provider without intervening logs.
Both owner unregistration and registry clearing reject subsequent ordinary and
explicit-operation writes while existing canonical logs remain readable on disk.
The new write probes and code-step harness journey failed on the pre-repair code
and pass with the fixes. Final repair validation passed 227 tests across 13 files;
one additional command-process registration test could not start because the
sandbox denied `/bin/ps`. `pnpm check:fast` passed, including production/test
types, lint, task validation, and generated client bindings.

Static validation and production TypeScript emission passed. The normal packaged
build could not clean sandbox-protected `dist`; emission used this run's artifact
directory. Broader daemon socket and command-process probes were unavailable
because the sandbox denied loopback listeners and `/bin/ps`; scope ownership
regressions retain real storage/runtime/tool behavior with only the external
port-availability probe controlled. Module-filesystem confinement remains with
its separately owned task.

The Telegram harness-session repair propagates the host's live provider resolver
through session creation and every harness turn. The resolver is required by
the Telegram harness session contract. A real Telegram message/session journey
through the OpenAI tool adapter verifies successful named queries and listings,
then unavailable responses in the same conversation after provider withdrawal,
while the canonical files remain. The rendered Telegram replies also exclude
the retired log sentinel. Only the external model and HTTP ports are controlled.
This repair passed 106 tests across six files, covering hosted ownership,
Telegram bot/session behavior, scope runtimes, log storage, and module_factory.
`pnpm check:fast` passed. No live Telegram or model request was needed to prove
this deterministic propagation boundary.
