---
id: task-fix-cli-interactive-mode-robustness
title: Fix CLI interactive mode robustness
status: ready
priority: p1
area: cli
summary: CLI interactive mode shows noisy module warnings, crashes on auth errors when no API key is set, and built-in commands fail without auth. Make startup clean, auth-free commands work without a configured model, and align CLI mode behavior with daemon mode.
created_at: 2026-04-15T14:28:15.544Z
updated_at: 2026-04-15T14:28:15.544Z
---

## Problem

CLI interactive mode (`node dist/cli.js`) has several UX issues:

1. **Noisy startup**: Every inactive module prints a WARN line (browser, email, github, google-workspace, slack-channel). These are expected when modules lack config and should not clutter the user's first impression.
2. **Auth crash on all input**: Typing anything (including built-in commands like `/reset`, `/status`) produces an unhandled Anthropic SDK error because no API key is set. Commands that do not require a model should work without auth.
3. **Shell oddity**: `node:unfunction: no such hash table element: node` appears on startup, suggesting a shell/env issue in the CLI entrypoint.
4. **Inconsistency with daemon mode**: `node dist/cli.js daemon` handles missing auth gracefully, but interactive mode does not.

## Desired Outcome

- Module warnings for unconfigured optional modules are suppressed or downgraded to debug-level output during normal startup.
- Built-in commands (`/status`, `/reset`, `/help`, etc.) execute without requiring a configured model or API key.
- Chat input that requires a model returns a clear user-facing error ("No model configured — set ANTHROPIC_API_KEY or configure a provider") instead of an unhandled SDK exception.
- Startup output is clean: banner, ready prompt, no wall of warnings.
- Behavior is consistent between interactive and daemon modes for auth/config handling.

## Constraints

- Do not remove module warnings entirely — they should remain available at a verbose/debug log level for troubleshooting.
- Do not require auth at startup; defer auth checks to the point where a model call is actually needed.

## Done When

- `node dist/cli.js` with no API key configured shows a clean startup and accepts built-in commands.
- Typing a chat message with no API key returns a user-friendly error, not a stack trace.
- Module WARN lines do not appear at default log level for expected-missing optional config.
- `node:unfunction` shell artifact is resolved or documented.
