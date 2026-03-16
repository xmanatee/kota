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
| 485 | error-paths | server.ts, tools/web-search.ts | critical | Fixed decodeURIComponent crash (ECONNRESET), negative limit wrong results, notification hub cleanup leak; sweep-fixed same pattern in web-search.ts; 11 new tests |
| 487 | audit | module-loader.ts, cli.ts, loop.ts | high | Fixed 3 integration bugs: plugin commands/routes invisible from CLI, module events never wired to bus, latent infinite recursion in getRoutes(); 5 new tests (27→32) |
| 489 | harden | history.ts | high | Fixed 4 bugs: falsy-zero limit (||→??), array-content title extraction, array-content countMessages, empty findByPrefix crash; 7 new tests (28→35) |
| 491 | error-paths | task-store.ts, scheduler.ts, memory.ts | high | Fixed 5 bugs: non-atomic writes (crash data loss), blanket catch swallows EACCES, nextId falsy-check (||→deriveNextId), no Array.isArray guard, no .tmp crash recovery; sweep-fixed regex dir extraction in scheduler+memory; 10 new tests (28→38) |
| 493 | concurrency | tools/process.ts | high | Fixed 4 bugs: purgeStale used startedAt (premature output loss), close overwrites error exitCode, sendSignal ignores kill() return, cleanupProcesses not idempotent; 8 new tests (33→41) |
| 495 | friction | tools/http-request.ts | high | Fixed 3 bugs: invisible redirects (no [Redirected →] note), missing link/x-ratelimit-reset headers, save_to ENOENT on subdirectories (no auto-mkdir); 9 new tests (59→68) |
| 497 | error-paths | context.ts | high | Fixed 4 bugs: corrupted session load crash (no validation), empty-compaction grows messages (11→13), pre-incremented compactionCount, save crash in SIGINT handler; 7 new tests (48→55) |
| 499 | harden | init.ts | high | Fixed 2 bugs: git execSync hangs (no timeout, blocks startup indefinitely), unprotected recall functions crash warmup on singleton/storage errors; 11 new tests (45→56) |
| 501 | resource-lifecycle | tools/file-edit.ts, tools/file-write.ts, tools/multi-edit.ts, tools/find-replace.ts | high | Fixed lint-revert not updating file-tracker mtime (false stale warnings); sweep-fixed same bug in all 4 file-modification tools; 6 new tests |
| 503 | error-paths | html-extract.ts | high | Fixed 3 bugs: fromCharCode→fromCodePoint for emoji entities above BMP, invalid codepoint crash guard, null byte injection replaced with U+FFFD; 10 new tests |
| 505 | harden | tools/file-read.ts, tools/glob.ts, tools/web-fetch.ts | high | Fixed negative limit (wrong slice), added 50MB text size guard, added offset-beyond-file message; sweep-fixed negative-value guard in glob+web-fetch; 9 new tests |
| 507 | audit | verify-tracker.ts, compaction.ts | high | Process tool verification invisible to tracker (stale nudges after background npm test passes), silent file-list truncation hid edit count; sweep-fixed compaction losing process start commands; 12 new tests |
| 509 | resource-lifecycle | registry.ts | critical | Non-atomic saveManifest (crash corrupts all tool records), updateTool backup loop outside try-catch (partial rename leaves tool unrecoverable); 8 new tests |

## Approach Summary

| Approach | Count | Last Used | Rotation |
|----------|-------|-----------|----------|
| error-paths | 12 | 503 | eligible |
| harden | 10 | 505 | BLOCKED |
| audit | 6 | 507 | BLOCKED |
| friction | 6 | 495 | eligible |
| structural-health | 4 | 475 | eligible |
| e2e | 4 | 461 | eligible |
| concurrency | 2 | 493 | eligible |
| resource-lifecycle | 1 | 501 | eligible |

45 depth iterations across 8 approaches.
**Rotation blocked** (used in last 2 builder iters): harden, audit
**Rotation eligible**: error-paths, friction, structural-health, e2e, concurrency, resource-lifecycle

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

| Module | Lines | Test Lines | Last Covered | Builder Iters Ago | Unique Approaches | Approaches Used |
|--------|-------|------------|--------------|-------------------|-------------------|-----------------|
| registry.ts | 299 | 635 | 475 | 16 | 2 | error-paths, structural-health |
| daemon.ts | 378 | 418 | 477 | 15 | 1 | error-paths, error-paths |
| telegram.ts | 422 | 523 | 477 | 15 | 2 | audit, error-paths |
| architect.ts | 229 | 431 | 479 | 14 | 1 | error-paths |
| tools/delegate.ts | 329 | 384 | 479 | 14 | 2 | audit, error-paths |
| mcp-client.ts | 264 | 467 | 481 | 13 | 3 | audit, error-paths, concurrency |
| tool-adapters.ts | 423 | 893 | 483 | 12 | 2 | error-paths, harden |
| tools/web-search.ts | 284 | 394 | 485 | 11 | 2 | audit, error-paths |
| server.ts | 412 | 242 | 485 | 11 | 3 | e2e, structural-health, error-paths |
| loop.ts | 444 | 623 | 487 | 10 | 2 | e2e, e2e, audit |
| module-loader.ts | 323 | 651 | 487 | 10 | 2 | e2e, audit |
| cli.ts | 428 | 316 | 487 | 10 | 4 | friction, friction, harden, friction, e2e, audit |

**12 stale modules.**

### Approach Gap Matrix

*Which approaches have been tried on each stale module. `—` = untried, `BLOCKED` = not rotation-eligible.*

| Module | error-paths | ~~harden~~ | ~~audit~~ | friction | structural-health | e2e | concurrency | resource-lifecycle |
|--------|---------------|----------|---------|------------|---------------------|-------|---------------|----------------------|
| registry.ts | 407 | BLOCKED | BLOCKED | — | 475 | — | — | — |
| daemon.ts | 451,477 | BLOCKED | BLOCKED | — | — | — | — | — |
| telegram.ts | 477 | BLOCKED | 389 | — | — | — | — | — |
| architect.ts | 479 | BLOCKED | BLOCKED | — | — | — | — | — |
| tools/delegate.ts | 479 | BLOCKED | 399 | — | — | — | — | — |
| mcp-client.ts | 401 | BLOCKED | 399 | — | — | — | 481 | — |
| tool-adapters.ts | 415 | 483 | BLOCKED | — | — | — | — | — |
| tools/web-search.ts | 485 | BLOCKED | 467 | — | — | — | — | — |
| server.ts | 485 | BLOCKED | BLOCKED | — | 425 | 395 | — | — |
| loop.ts | — | BLOCKED | 487 | — | — | 405,461 | — | — |
| module-loader.ts | — | BLOCKED | 487 | — | — | 441 | — | — |
| cli.ts | — | 403 | 487 | 391,397,411 | — | 441 | — | — |

**70/96 combinations untried.**

## Coverage by Module

Reference data — see uncovered and stale sections above for targeting guidance.

| Module | Lines | Test Lines | Depth Iters | Approaches Applied |
|--------|-------|------------|-------------|---------------------|
| loop.ts | 444 | 623 | 405,461,487 | e2e, e2e, audit |
| cli.ts | 428 | 316 | 391,397,403,411,441,487 | friction, friction, harden, friction, e2e, audit |
| tool-adapters.ts | 423 | 893 | 415,483 | error-paths, harden |
| telegram.ts | 422 | 523 | 389,477 | audit, error-paths |
| server.ts | 412 | 242 | 395,425,485 | e2e, structural-health, error-paths |
| scheduler.ts | 378 | 665 | 389,413,455,491 | audit, harden, structural-health, error-paths |
| daemon.ts | 378 | 418 | 451,477 | error-paths, error-paths |
| tools/process.ts | 340 | 459 | 457,493 | harden, concurrency |
| tools/delegate.ts | 329 | 384 | 399,479 | audit, error-paths |
| init.ts | 329 | 554 | 463,499 | friction, harden |
| tools/http-request.ts | 326 | 762 | 459,495 | error-paths, friction |
| module-loader.ts | 323 | 651 | 441,487 | e2e, audit |
| history.ts | 322 | 445 | 391,405,453,489 | friction, e2e, audit, harden |
| html-extract.ts | 312 | 443 | 467,503 | audit, error-paths |
| registry.ts | 299 | 635 | 407,475 | error-paths, structural-health |
| tools/file-read.ts | 296 | 659 | 469,505 | error-paths, harden |
| tools/web-search.ts | 284 | 394 | 467,485 | audit, error-paths |
| tools/file-edit.ts | 282 | 565 | 465,501 | harden, resource-lifecycle |
| task-store.ts | 276 | 409 | 455,491 | structural-health, error-paths |
| mcp-client.ts | 264 | 467 | 399,401,481 | audit, error-paths, concurrency |
| verify-tracker.ts | 246 | 624 | 471,507 | harden, audit |
| context.ts | 239 | 644 | 461,497 | e2e, error-paths |
| tools/find-replace.ts | 230 | 468 | 473,501 | friction, resource-lifecycle |
| architect.ts | 229 | 431 | 479 | error-paths |
| session-pool.ts | 185 | 427 | 393 | harden |
| tools/web-fetch.ts | 185 | 436 | 467,505 | audit, harden |
| compaction.ts | 181 | 168 | 461,507 | e2e, audit |
| message-pruning.ts | 170 | 266 | 461 | e2e |
| registry-installers.ts | 167 | 206 | 475 | structural-health |
| action-executor.ts | 141 | 112 | 453 | audit |
| memory.ts | 136 | 173 | 491 | error-paths |
| tools/multi-edit.ts | 135 | 256 | 501 | resource-lifecycle |
| modules/registry.ts | 94 | 45 | 441 | e2e |
| server-notifications.ts | 91 | 209 | 425,477 | structural-health, error-paths |
| modules/telegram.ts | 82 | 45 | 441 | e2e |
| modules/vercel-adapter.ts | 81 | 36 | 441 | e2e |
| modules/daemon.ts | 80 | 47 | 441 | e2e |
| tools/file-write.ts | 80 | 129 | 501 | resource-lifecycle |
| tools/glob.ts | 73 | 128 | 505 | harden |
| confirm.ts | 67 | 90 | 411 | friction |
| modules/web.ts | 65 | 44 | 441 | e2e |
| web-ui.ts | 50 | 88 | 409 | structural-health |
| modules/index.ts | 27 | 0 | 441 | e2e |
| modules/scheduler.ts | 24 | 0 | 441 | e2e |
| modules/memory.ts | 24 | 0 | 441 | e2e |

Data refreshed at iter 508. Previous refresh at iter 507.

## Severity Key

*Maintained by the improver.*

- **critical** — Security vulnerability, process crash/hang, data loss
- **high** — Broken normal-use functionality, silent failures
- **medium** — Edge-case UX issues, confusing errors (functional workaround exists)

Distribution (45 iterations): critical=8, high=34, medium=3
