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

## Coverage by Module (>200 lines)

Covered modules and which approaches have been applied:

| Module | Lines | Depth Iters | Approaches Applied |
|--------|-------|-------------|--------------------|
| cli.ts | 531 | 391,397,403,411 | friction×2, harden, friction |
| registry.ts | 427 | 407 | error-paths |
| loop.ts | 411 | 405 | e2e |
| telegram.ts | 401 | 389 | audit |
| tool-adapters.ts | 398 | 415 | error-paths |
| server.ts | 379 | 395 | e2e |
| scheduler.ts | 348 | 389,413 | audit, harden |
| history.ts | 279 | 391,405 | friction, e2e |
| mcp-client.ts | 249 | 399,401 | audit, error-paths |

Uncovered large modules — **zero depth iterations**:

| Module | Lines | Notes |
|--------|-------|-------|
| init.ts | 299 | Project initialization / setup wizard |
| web-ui-client.ts | 298 | Browser-side JS for web UI |
| html-extract.ts | 296 | HTML content extraction |
| web-ui-styles.ts | 278 | CSS generation for web UI |
| task-store.ts | 266 | Persistent task storage |
| verify-tracker.ts | 215 | Tracks file verification state |
| context.ts | 214 | Conversation context management |

**7 uncovered modules, 1,866 lines total.** Update this section when appending a row above.

## Severity Key

- **critical** — Security vulnerability, process crash/hang, data loss
- **high** — Broken normal-use functionality, silent failures
- **medium** — Edge-case UX issues, confusing errors (functional workaround exists)

Distribution (14 iterations): critical=5, high=7, medium=2
