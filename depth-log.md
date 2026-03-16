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
| 471 | harden | verify-tracker.ts | high | Failed shell verification commands (is_error: true) silently cleared edit tracker, defeating verification nudges; added bun/deno command detection; 10 new tests (38→50) |
| 473 | friction | tools/find-replace.ts | high | Dotfiles silently skipped (glob without dot:true), lint-failure rollback lost error context and falsely claimed success, no glob limit before scanning; sweep-fixed same rollback bug in multi-edit.ts; 12 new tests (19→31) |
| 475 | structural-health | registry.ts, registry-installers.ts | high | Split 427-line registry.ts (299+167); fixed getNpmVersion dead-code fallback and installGithub wrong files path; 19 new tests for extracted installers |
| 477 | error-paths | telegram.ts, daemon.ts, server-notifications.ts | high | Fixed 4 bugs: non-JSON response crash, network errors without method context, flush stops at first failed chunk, partial output dropped on agent error; sweep-fixed silent error swallow in daemon + server-notifications; 9 new tests (28→37) |
| 479 | error-paths | tools/delegate.ts, architect.ts | high | Fixed 3 bugs: no API retry on transient errors (429/503), tool runner exceptions crash delegation, fatal API errors thrown raw; sweep-fixed same missing retry in architect.ts; 12 new tests |
| 481 | concurrency | mcp-client.ts | high | Fixed 3 concurrency bugs: concurrent connect() leaks orphaned child process, close() during connect() leaves stale connected=true, close() resets closing flag allowing broken re-entry; 6 new tests (27→33) |
| 483 | harden | tool-adapters.ts | high | Fixed 4 bugs: Zod wrapper unwrap discards description, Error objects normalize to "{}", ZodNullable drops nullability, ZodDefault drops default value; 18 new tests (61→79) |

## Approach Summary

| Approach | Count | Last Used | Rotation |
|----------|-------|-----------|----------|
| error-paths | 8 | 479 | BLOCKED |
| harden | 6 | 471 | eligible |
| friction | 5 | 473 | eligible |
| structural-health | 4 | 475 | eligible |
| audit | 4 | 467 | eligible |
| e2e | 4 | 461 | eligible |
| concurrency | 1 | 481 | BLOCKED |

32 depth iterations across 7 approaches.
**Rotation blocked** (used in last 2 builder iters): error-paths, concurrency
**Rotation eligible**: harden, friction, structural-health, audit, e2e

## Uncovered Modules — PRIMARY Targets

These modules have **zero depth iterations**. They are blind spots — no one has
examined their error handling, edge cases, integration seams, or structural
health. Prioritize these over already-covered modules.

**Test Lines** = existing breadth-phase test coverage. Modules with 0 test
lines are the highest-risk blind spots.

*All modules ≥200 lines have depth coverage.*

*Excluded from depth targeting (view-only template literals): `web-ui-client.ts`, `web-ui-styles.ts`.*

## Stale Coverage — PRIMARY Targets

*Auto-generated. All modules have initial depth coverage — stale modules are now
your primary targets. Covered modules (≥200 lines) whose last depth coverage
was ≥10 builder iterations ago. Use the approach gap matrix below to
find untried module+approach combinations.*

| Module | Lines | Test Lines | Last Covered | Builder Iters Ago | Approaches Used |
|--------|-------|------------|--------------|-------------------|-----------------|
| tool-adapters.ts | 403 | 641 | 415 | 33 | error-paths |
| server.ts | 400 | 242 | 425 | 28 | e2e, structural-health |
| cli.ts | 424 | 316 | 441 | 20 | friction, friction, harden, friction, e2e |
| module-loader.ts | 312 | 506 | 441 | 20 | e2e |
| history.ts | 305 | 342 | 453 | 14 | friction, e2e, audit |
| scheduler.ts | 378 | 665 | 455 | 13 | audit, harden, structural-health |
| task-store.ts | 259 | 280 | 455 | 13 | structural-health |
| tools/process.ts | 327 | 335 | 457 | 12 | harden |
| tools/http-request.ts | 318 | 624 | 459 | 11 | error-paths |
| loop.ts | 438 | 623 | 461 | 10 | e2e, e2e |
| context.ts | 221 | 533 | 461 | 10 | e2e |

**11 stale modules.**

### Approach Gap Matrix

*Which approaches have been tried on each stale module. `—` = untried, `BLOCKED` = not rotation-eligible.*

| Module | ~~error-paths~~ | harden | friction | structural-health | audit | e2e | ~~concurrency~~ |
|--------|---------------|----------|------------|---------------------|---------|-------|---------------|
| tool-adapters.ts | 415 | — | — | — | — | — | BLOCKED |
| server.ts | BLOCKED | — | — | 425 | — | 395 | BLOCKED |
| cli.ts | BLOCKED | 403 | 391,397,411 | — | — | 441 | BLOCKED |
| module-loader.ts | BLOCKED | — | — | — | — | 441 | BLOCKED |
| history.ts | BLOCKED | — | 391 | — | 453 | 405 | BLOCKED |
| scheduler.ts | BLOCKED | 413 | — | 455 | 389 | — | BLOCKED |
| task-store.ts | BLOCKED | — | — | 455 | — | — | BLOCKED |
| tools/process.ts | BLOCKED | 457 | — | — | — | — | BLOCKED |
| tools/http-request.ts | 459 | — | — | — | — | — | BLOCKED |
| loop.ts | BLOCKED | — | — | — | — | 405,461 | BLOCKED |
| context.ts | BLOCKED | — | — | — | — | 461 | BLOCKED |

**59/77 combinations untried.**

## Coverage by Module

Reference data — see uncovered and stale sections above for targeting guidance.

| Module | Lines | Test Lines | Depth Iters | Approaches Applied |
|--------|-------|------------|-------------|---------------------|
| loop.ts | 438 | 623 | 405,461 | e2e, e2e |
| cli.ts | 424 | 316 | 391,397,403,411,441 | friction, friction, harden, friction, e2e |
| telegram.ts | 422 | 523 | 389,477 | audit, error-paths |
| tool-adapters.ts | 403 | 641 | 415 | error-paths |
| server.ts | 400 | 242 | 395,425 | e2e, structural-health |
| scheduler.ts | 378 | 665 | 389,413,455 | audit, harden, structural-health |
| daemon.ts | 378 | 418 | 451,477 | error-paths, error-paths |
| tools/delegate.ts | 329 | 384 | 399,479 | audit, error-paths |
| tools/process.ts | 327 | 335 | 457 | harden |
| tools/http-request.ts | 318 | 624 | 459 | error-paths |
| init.ts | 315 | 453 | 463 | friction |
| module-loader.ts | 312 | 506 | 441 | e2e |
| history.ts | 305 | 342 | 391,405,453 | friction, e2e, audit |
| registry.ts | 299 | 635 | 407,475 | error-paths, structural-health |
| html-extract.ts | 296 | 377 | 467 | audit |
| tools/file-read.ts | 282 | 564 | 469 | error-paths |
| tools/file-edit.ts | 280 | 518 | 465 | harden |
| tools/web-search.ts | 280 | 382 | 467 | audit |
| mcp-client.ts | 264 | 467 | 399,401,481 | audit, error-paths, concurrency |
| task-store.ts | 259 | 280 | 455 | structural-health |
| tools/find-replace.ts | 229 | 449 | 473 | friction |
| architect.ts | 229 | 431 | 479 | error-paths |
| verify-tracker.ts | 227 | 514 | 471 | harden |
| context.ts | 221 | 533 | 461 | e2e |
| session-pool.ts | 185 | 427 | 393 | harden |
| tools/web-fetch.ts | 185 | 436 | 467 | audit |
| compaction.ts | 178 | 151 | 461 | e2e |
| message-pruning.ts | 170 | 266 | 461 | e2e |
| registry-installers.ts | 167 | 206 | 475 | structural-health |
| action-executor.ts | 141 | 112 | 453 | audit |
| modules/registry.ts | 94 | 45 | 441 | e2e |
| server-notifications.ts | 91 | 209 | 425,477 | structural-health, error-paths |
| modules/telegram.ts | 82 | 45 | 441 | e2e |
| modules/vercel-adapter.ts | 81 | 36 | 441 | e2e |
| modules/daemon.ts | 80 | 47 | 441 | e2e |
| confirm.ts | 67 | 90 | 411 | friction |
| modules/web.ts | 65 | 44 | 441 | e2e |
| web-ui.ts | 50 | 88 | 409 | structural-health |
| modules/index.ts | 27 | 0 | 441 | e2e |
| modules/scheduler.ts | 24 | 0 | 441 | e2e |
| modules/memory.ts | 24 | 0 | 441 | e2e |

Data refreshed at iter 482. Previous refresh at iter 481.

## Severity Key

*Maintained by the improver.*

- **critical** — Security vulnerability, process crash/hang, data loss
- **high** — Broken normal-use functionality, silent failures
- **medium** — Edge-case UX issues, confusing errors (functional workaround exists)

Distribution (32 iterations): critical=7, high=22, medium=3
