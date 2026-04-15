---
id: task-add-browser-automation-module
title: Add browser automation module
status: done
priority: p1
area: modules
summary: The architecture doc lists browser use as a capability that should be module-owned. KOTA has web_fetch and web_search but no interactive browser automation. Add a module providing headless browser tools (page navigation, element interaction, screenshot capture, JS evaluation) that agents can use for web scraping, form filling, and UI verification.
created_at: 2026-04-15T02:51:01.287Z
updated_at: 2026-04-15T03:48:41.094Z
---

## Problem

KOTA's web-access module provides `web_fetch`, `web_search`, and `http_request`
tools — all stateless, single-request operations. Agents cannot interact with
JavaScript-rendered pages, fill forms, click buttons, navigate multi-page flows,
or capture screenshots. The architecture doc explicitly lists browser use as a
capability that should be module-owned, but no such module exists.

This gap blocks agents from tasks that require authenticated web sessions,
dynamic page interaction, or visual verification of UI changes.

## Desired Outcome

A `browser` module in `src/modules/browser/` that contributes headless browser
tools to the agent tool registry:

- `browser_navigate` — load a URL, wait for network idle or selector.
- `browser_click` / `browser_type` — interact with page elements by selector.
- `browser_screenshot` — capture full-page or element screenshot, return as
  base64 or file path.
- `browser_evaluate` — run a JS expression in page context and return the result.
- `browser_get_text` — extract visible text or structured content from the page.

The module manages a browser instance lifecycle (launch on first use, reuse
across tool calls within a session, close on session end or idle timeout).

## Constraints

- Use Playwright as the browser engine (MIT-licensed, supports Chromium/Firefox/WebKit).
- Classify all browser tools as `destructive` risk in guardrails since they
  execute arbitrary page-side JS and can trigger external side effects.
- Do not add Playwright as a required dependency — make it a peer dependency or
  lazy-import so the module loads only when Playwright is installed.
- Keep the module self-contained. No core changes required.
- Screenshots should respect a configurable max size to avoid flooding agent
  context.

## Done When

- Module loads and contributes tools discoverable via `kota tool list`.
- An agent can navigate to a page, interact with elements, and capture a
  screenshot in a single session.
- Tools have proper risk classification and schema validation.
- Module has AGENTS.md and tests covering tool schema, lifecycle, and error
  paths.
- Playwright absence produces a clear warning at module load, not a crash.
