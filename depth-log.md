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

## Coverage by Module (>200 lines)

Covered modules and which approaches have been applied:

| Module | Lines | Depth Iters | Approaches Applied |
|--------|-------|-------------|--------------------|
| cli.ts | 429 | 391,397,403,411 | friction×2, harden, friction |
| scheduler.ts | 471 | 389,413 | audit, harden |
| loop.ts | 437 | 405 | e2e |
| registry.ts | 427 | 407 | error-paths |
| server.ts | 400 | 395,425 | e2e, structural-health |
| tool-adapters.ts | 403 | 415 | error-paths |
| telegram.ts | 401 | 389 | audit |
| history.ts | 279 | 391,405 | friction, e2e |
| mcp-client.ts | 249 | 399,401 | audit, error-paths |

**Stale coverage warning** — these covered modules were substantially modified
during plan execution (iters 417-439). Their depth coverage predates the changes:

- `cli.ts` (modified iters 431-437): 6 commands extracted into modules; remaining
  code is module-loading logic, fundamentally different from what iters 391-411
  tested. Shrank from 571→429 lines.
- `server.ts` (modified iter 439): Hardcoded Vercel handling removed, module route
  integration added — different HTTP dispatch logic from what iters 395, 425 tested.
  Shrank from 413→400 lines.
- `loop.ts` (modified iter 427): Module loading added to startup — the e2e test
  from iter 405 doesn't cover this path.
- `scheduler.ts` (modified iters 417-423): Grew ~30% with event-trigger code that
  has had zero depth scrutiny. Same-module/different-approach coverage is valuable.

`session-pool.ts` (185 lines, covered iter 393) and `web-ui.ts` (50 lines,
covered iter 409 — was 612, split into web-ui-client/styles/markdown) are
below 200 lines now but have historical coverage.

Uncovered large modules — **zero depth iterations**:

| Module | Lines | Notes |
|--------|-------|-------|
| daemon.ts | 350 | Long-running event-driven runtime (iter 421) |
| tools/delegate.ts | 302 | Sub-agent delegation tool |
| init.ts | 299 | Project initialization / setup wizard |
| web-ui-client.ts | 298 | Browser-side JS for web UI |
| html-extract.ts | 296 | HTML content extraction |
| tools/http-request.ts | 289 | HTTP request tool |
| tools/process.ts | 287 | Process management tool |
| tools/web-search.ts | 286 | Web search tool |
| web-ui-styles.ts | 278 | CSS generation for web UI |
| tools/file-edit.ts | 274 | File editing tool |
| task-store.ts | 266 | Persistent task storage |
| tools/file-read.ts | 255 | File reading tool |
| verify-tracker.ts | 215 | Tracks file verification state |
| context.ts | 214 | Conversation context management |
| module-loader.ts | 207 | Module discovery + lifecycle (new in iter 427) |
| tools/find-replace.ts | 202 | Find-and-replace tool |

**16 uncovered modules, 4,218 lines total.** Update this section when
appending a row above.

Data refreshed at iter 440. The modular architecture plan completed in iter
439. It added `src/modules/` (thin wrappers, all <85 lines) and
`module-loader.ts` (207 lines, framework code with zero depth coverage).
Builder re-enters depth phase at iter 441.

## Severity Key

- **critical** — Security vulnerability, process crash/hang, data loss
- **high** — Broken normal-use functionality, silent failures
- **medium** — Edge-case UX issues, confusing errors (functional workaround exists)

Distribution (15 iterations): critical=5, high=8, medium=2

Note: src/tools/ files were previously omitted from this log. 7 tools exceed
200 lines with zero depth coverage — prime targets for the next depth phase.
