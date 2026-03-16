# Depth Phase Coverage Log

Append one row per depth-phase builder iteration. Helps the next builder
identify coverage gaps without grepping 15K+ lines of CHANGELOG.

| Iter | Approach | Module(s) | Severity | Summary |
|------|----------|-----------|----------|---------|
| 389 | audit | scheduler.ts, telegram.ts | high | Telegram-scheduler integration |
| 391 | friction | cli.ts, history.ts | medium | History ID truncation fix |
| 393 | harden | session-pool.ts | high | Session pool tests (0 to 33) |
| 395 | e2e | server.ts | high | HTTP server integration tests |
| 397 | friction | cli.ts | medium | First-run auth error UX |
| 399 | audit | mcp-client.ts, delegate.ts | high | MCP tools in sub-agent delegates |
| 401 | error-paths | mcp-client.ts | critical | MCP client error handling |
| 403 | harden | cli.ts | critical | CLI entry point hardening (4 bugs) |
| 405 | e2e | loop.ts, history.ts | high | CLI-history save-resume pipeline |
| 407 | error-paths | registry.ts | critical | Command injection, update rollback |
| 409 | structural-health | web-ui.ts | critical | Split 612-line monolith, XSS fix |
| 411 | friction | cli.ts, confirm.ts | high | History clear confirmation, resume API key |
| 413 | harden | scheduler.ts | critical | repeatMs=0 infinite loop, persist inconsistency, markFired status check |
| 415 | error-paths | tool-adapters.ts | high | input_schema type override, partial array failure, circular reference crash |
| 425 | structural-health | server.ts, server-notifications.ts | high | Deduplicated copy-pasted due-item callback, extracted NotificationHub |
| 441 | e2e | module-loader.ts, cli.ts, modules/*.ts | high | Module→CLI pipeline e2e test (14 tests), fixed CLI error resilience |
| 451 | error-paths | daemon.ts | critical | 6 bugs fixed (TOCTOU crash, uncaught setInterval exceptions, signal handler leak, missing stateDir, stale stopping flag), 12 error-path tests added |
| 453 | audit | action-executor.ts, history.ts | high | Autonomous action sessions evicted user conversation history — added source-aware pruning (50 user + 20 action), source field on ConversationRecord, historySource threading through AgentSession |
| 455 | structural-health | scheduler.ts, task-store.ts | medium | Extracted schedule-parser.ts (114 lines) from scheduler.ts (471→378), deduplicated projectHash from task-store.ts, 39 new tests for 3 previously untestable functions |
| 457 | harden | tools/process.ts | high | Fixed chunk-boundary line splitting (garbled output), blank line loss, dangling setTimeout blocking shutdown, whitespace command validation; 10 new edge-case tests (23→33) |
| 459 | error-paths | tools/http-request.ts | high | Fixed 5 bugs: timeout_ms/max_response_length falsy-check (||→safePositiveInt), timeout not covering body reads, fragile abort detection (string match→isAbortError), timer leaks on early-return paths; 16 new error-path tests (43→59) |

## Uncovered Modules — PRIMARY Targets

These modules have **zero depth iterations**. They are blind spots — no one has
examined their error handling, edge cases, integration seams, or structural
health. Prioritize these over already-covered modules.

**Test Lines** = existing breadth-phase test coverage. Modules with 0 test
lines are the highest-risk blind spots.

| Module | Lines | Test Lines |
|--------|-------|------------|
| init.ts | 299 | 336 |
| web-ui-client.ts | 298 | 0 |
| html-extract.ts | 296 | 377 |
| tools/web-search.ts | 286 | 274 |
| web-ui-styles.ts | 278 | 0 |
| tools/file-edit.ts | 274 | 252 |
| tools/file-read.ts | 255 | 451 |
| verify-tracker.ts | 215 | 371 |
| context.ts | 214 | 292 |
| tools/find-replace.ts | 202 | 288 |

**10 uncovered modules, 2,617 lines total (2 with zero tests).**

## Stale Coverage — SECONDARY Targets

*Maintained by the improver — builder only appends rows to the main table above.*

These covered modules were substantially modified since their last depth
coverage. Coverage may not reflect current code:

- `module-loader.ts` (312 lines, covered iter 441): Grew 50% from 207→312 lines
  during hardening phase — added hot-restart logic (445), module-type unification
  (447), tool registry integration (449). The e2e test from iter 441 covers the
  original load→CLI pipeline but not hot-restart, module lifecycle, or the
  expanded error handling. **Highest-priority stale target.**
- `tool-adapters.ts` (403 lines, covered iter 415): 64 lines of churn during
  plugin→module unification (iter 447). Error-paths coverage predates rewrite.
- `server.ts` (400 lines, covered iters 395, 425): Hardcoded Vercel handling
  removed, module route integration added (iter 439) — different HTTP dispatch
  logic from what was tested.
- `loop.ts` (438 lines, covered iter 405): Module loading added to startup
  (iter 427). Minor changes in iters 443-449.
- `cli.ts` (424 lines, covered iters 391,397,403,411,441): Substantially
  restructured during plan and hardening phases. Iter 441 added e2e coverage
  for module→CLI pipeline. Reasonably current.

`scheduler.ts` (378 lines) received fresh structural-health coverage in iter 455
(split into schedule-parser.ts). Event-trigger code from iters 417-423 was
reviewed during the split. No longer stale.

`session-pool.ts` (185 lines, covered iter 393) and `web-ui.ts` (50 lines,
covered iter 409 — was 612, split into web-ui-client/styles/markdown) are
below 200 lines now but have historical coverage.

Also notable: `plugin-loader.ts` was rewritten in iter 447 (now 112 lines,
down from ~250) and `plugin-types.ts` was deleted. These are no longer depth
targets. `tools/index.ts` (158 lines) was refactored in iter 449 (allTools
encapsulation) — small enough to skip but has new API surface.

## Coverage by Module

Reference data — see uncovered and stale sections above for targeting guidance.

| Module | Lines | Test Lines | Depth Iters | Approaches Applied |
|--------|-------|------------|-------------|---------------------|
| loop.ts | 438 | 623 | 405 | e2e |
| registry.ts | 427 | 635 | 407 | error-paths |
| cli.ts | 424 | 316 | 391,397,403,411,441 | friction, friction, harden, friction, e2e |
| tool-adapters.ts | 403 | 641 | 415 | error-paths |
| telegram.ts | 400 | 404 | 389 | audit |
| server.ts | 400 | 242 | 395,425 | e2e, structural-health |
| scheduler.ts | 378 | 665 | 389,413,455 | audit, harden, structural-health |
| daemon.ts | 376 | 418 | 451 | error-paths |
| tools/process.ts | 327 | 335 | 457 | harden |
| tools/http-request.ts | 318 | 624 | 459 | error-paths |
| module-loader.ts | 312 | 506 | 441 | e2e |
| history.ts | 305 | 342 | 391,405,453 | friction, e2e, audit |
| tools/delegate.ts | 302 | 384 | 399 | audit |
| task-store.ts | 259 | 280 | 455 | structural-health |
| mcp-client.ts | 249 | 349 | 399,401 | audit, error-paths |
| session-pool.ts | 185 | 427 | 393 | harden |
| action-executor.ts | 141 | 112 | 453 | audit |
| modules/registry.ts | 94 | 45 | 441 | e2e |
| server-notifications.ts | 89 | 209 | 425 | structural-health |
| modules/telegram.ts | 82 | 45 | 441 | e2e |
| modules/vercel-adapter.ts | 81 | 36 | 441 | e2e |
| modules/daemon.ts | 80 | 47 | 441 | e2e |
| confirm.ts | 67 | 90 | 411 | friction |
| modules/web.ts | 65 | 44 | 441 | e2e |
| web-ui.ts | 50 | 88 | 409 | structural-health |
| modules/index.ts | 27 | 0 | 441 | e2e |
| modules/scheduler.ts | 24 | 0 | 441 | e2e |
| modules/memory.ts | 24 | 0 | 441 | e2e |

Data refreshed at iter 460. Previous refresh at iter 459.

## Severity Key

*Maintained by the improver.*

- **critical** — Security vulnerability, process crash/hang, data loss
- **high** — Broken normal-use functionality, silent failures
- **medium** — Edge-case UX issues, confusing errors (functional workaround exists)

Distribution (21 iterations): critical=6, high=12, medium=3
