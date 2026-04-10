# Tool Retry Module

This directory owns the `tool-retry` repo module — retry middleware for transient tool failures.

- Registers retry middleware at priority 20 (after cache at 10, before custom middleware at 100+).
- Auto-retries network tools on transient errors and shell commands on timeout with doubled timeout.
- Session-scoped: retry stats reset on unload.
- Middleware implementation is co-located at `tool-retry.ts`.

