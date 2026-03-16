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
| 461 | e2e | context.ts, loop.ts, compaction.ts, message-pruning.ts | critical | Fixed compact() producing consecutive same-role messages (~50% of compactions crashed with API 400); 13 new e2e tests for prune→compact→truncate pipeline |
| 463 | friction | init.ts | high | Fixed 3 warmup bugs: git status dropped deletions/renames (silent omission), "ago" plural errors ("1 minutes ago"), ungrammatical environment labels ("2 documents files"); 10 new tests |
| 465 | harden | tools/file-edit.ts | high | Fixed $ substitution corruption in replacement strings ($&, $$, $`, $' silently mangled output) and fuzzy-match line misdirection; 18 new edge-case tests (19→37) |
| 467 | audit | tools/web-search.ts, html-extract.ts, tools/web-fetch.ts | high | web-search duplicated stripTags missing 11 entity types (&mdash; &hellip; etc. rendered as raw text); sweep-fixed fragile abort detection in web-search + web-fetch; 12 new tests |
| 469 | error-paths | tools/file-read.ts | high | Fixed 4 bugs: missing directory check (EISDIR), TOCTOU in readText (redundant statSync after readFileSync), 5→1 statSync consolidation, permission errors from isBinaryFile; sweep-fixed directory-path bug in file-edit/multi-edit/file-write; 12 new tests (42→54) |

## Approach Summary

| Approach | Count | Last Used |
|----------|-------|-----------|
| error-paths | 6 | 469 |
| harden | 5 | 465 |
| audit | 4 | 467 |
| friction | 4 | 463 |
| e2e | 4 | 461 |
| structural-health | 3 | 455 |

26 depth iterations across 6 approaches.

## Uncovered Modules — PRIMARY Targets

These modules have **zero depth iterations**. They are blind spots — no one has
examined their error handling, edge cases, integration seams, or structural
health. Prioritize these over already-covered modules.

**Test Lines** = existing breadth-phase test coverage. Modules with 0 test
lines are the highest-risk blind spots.

| Module | Lines | Test Lines |
|--------|-------|------------|
| verify-tracker.ts | 215 | 371 |
| tools/find-replace.ts | 202 | 288 |

**2 uncovered modules, 417 lines total (0 with zero tests).**

*Excluded from depth targeting (view-only template literals): `web-ui-client.ts`, `web-ui-styles.ts`.*

## Stale Coverage — SECONDARY Targets

*Auto-generated. Covered modules (≥200 lines) whose last depth coverage
was ≥10 builder iterations ago. Consider after exhausting uncovered modules.*

| Module | Lines | Test Lines | Last Covered | Builder Iters Ago | Approaches Used |
|--------|-------|------------|--------------|-------------------|-----------------|
| registry.ts | 427 | 635 | 407 | 31 | error-paths |
| cli.ts | 424 | 316 | 441 | 14 | friction, friction, harden, friction, e2e |
| tool-adapters.ts | 403 | 641 | 415 | 27 | error-paths |
| telegram.ts | 400 | 404 | 389 | 40 | audit |
| server.ts | 400 | 242 | 425 | 22 | e2e, structural-health |
| module-loader.ts | 312 | 506 | 441 | 14 | e2e |
| tools/delegate.ts | 302 | 384 | 399 | 35 | audit |
| mcp-client.ts | 249 | 349 | 401 | 34 | audit, error-paths |

**8 stale modules.**

## Coverage by Module

Reference data — see uncovered and stale sections above for targeting guidance.

| Module | Lines | Test Lines | Depth Iters | Approaches Applied |
|--------|-------|------------|-------------|---------------------|
| loop.ts | 438 | 623 | 405,461 | e2e, e2e |
| registry.ts | 427 | 635 | 407 | error-paths |
| cli.ts | 424 | 316 | 391,397,403,411,441 | friction, friction, harden, friction, e2e |
| tool-adapters.ts | 403 | 641 | 415 | error-paths |
| telegram.ts | 400 | 404 | 389 | audit |
| server.ts | 400 | 242 | 395,425 | e2e, structural-health |
| scheduler.ts | 378 | 665 | 389,413,455 | audit, harden, structural-health |
| daemon.ts | 376 | 418 | 451 | error-paths |
| tools/process.ts | 327 | 335 | 457 | harden |
| tools/http-request.ts | 318 | 624 | 459 | error-paths |
| init.ts | 315 | 453 | 463 | friction |
| module-loader.ts | 312 | 506 | 441 | e2e |
| history.ts | 305 | 342 | 391,405,453 | friction, e2e, audit |
| tools/delegate.ts | 302 | 384 | 399 | audit |
| html-extract.ts | 296 | 377 | 467 | audit |
| tools/file-read.ts | 282 | 564 | 469 | error-paths |
| tools/file-edit.ts | 280 | 518 | 465 | harden |
| tools/web-search.ts | 280 | 382 | 467 | audit |
| task-store.ts | 259 | 280 | 455 | structural-health |
| mcp-client.ts | 249 | 349 | 399,401 | audit, error-paths |
| context.ts | 221 | 533 | 461 | e2e |
| session-pool.ts | 185 | 427 | 393 | harden |
| tools/web-fetch.ts | 185 | 436 | 467 | audit |
| compaction.ts | 178 | 151 | 461 | e2e |
| message-pruning.ts | 170 | 266 | 461 | e2e |
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

Data refreshed at iter 470. Previous refresh at iter 469.

## Severity Key

*Maintained by the improver.*

- **critical** — Security vulnerability, process crash/hang, data loss
- **high** — Broken normal-use functionality, silent failures
- **medium** — Edge-case UX issues, confusing errors (functional workaround exists)

Distribution (26 iterations): critical=7, high=16, medium=3
