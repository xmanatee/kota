# Depth Phase Coverage Log

Append one row per depth-phase builder iteration. Helps the next builder
identify coverage gaps without grepping 15K+ lines of CHANGELOG.

| Iter | Approach | Module(s) | Summary |
|------|----------|-----------|---------|
| 389 | audit | scheduler.ts, telegram.ts | Telegram-scheduler integration |
| 391 | friction | cli.ts, history.ts | History ID truncation fix |
| 393 | harden | session-pool.ts | Session pool tests (0 to 33) |
| 395 | e2e | server.ts | HTTP server integration tests |
| 397 | friction | cli.ts | First-run auth error UX |
| 399 | audit | mcp-client.ts, delegate.ts | MCP tools in sub-agent delegates |
| 401 | error-paths | mcp-client.ts | MCP client error handling |
| 403 | harden | cli.ts | CLI entry point hardening (4 bugs) |
| 405 | e2e | loop.ts, history.ts | CLI-history save-resume pipeline |
| 407 | error-paths | registry.ts | Command injection, update rollback |
| 409 | structural-health | web-ui.ts | Split 612-line monolith, XSS fix |
| 411 | friction | cli.ts, confirm.ts | History clear confirmation, resume API key |
| 413 | harden | scheduler.ts | repeatMs=0 infinite loop, persist inconsistency, markFired status check |
