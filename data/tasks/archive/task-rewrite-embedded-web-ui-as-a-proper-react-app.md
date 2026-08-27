---
status: done
---

# Rewrite embedded web UI as a proper React app

## Problem

The KOTA web UI (`src/modules/web-ui/`) is ~4800 lines of JavaScript template
strings that get inlined into a single HTML page with no build step. CSS and JS
are exported as string constants from `.ts` files and concatenated at runtime.
This makes the UI hard to maintain, impossible to lint or typecheck on the
client side, and prevents use of component libraries, hot reload, or standard
frontend tooling.

## Desired Outcome

A standalone React app under `clients/web/` (or similar) built with
established tooling: Vite, TanStack Router, TanStack Query, Tailwind CSS, and
shadcn/ui. The app consumes the existing daemon HTTP+JSON API and SSE event
stream — the same contract the macOS and mobile clients already use. The old
embedded `web-ui` module is removed once the new client is serving.

## Constraints

- Must consume only the daemon control API; no direct `.kota/` file access.
- Existing daemon API routes must not change to accommodate the new client.
- The transition should not leave two parallel web UIs live.

## Done When

- A React app with build step replaces the embedded template-string UI.
- All current web UI capabilities (chat, runs, approvals, sessions, tasks, etc.) are present.
- Client-side code is linted, type-checked, and has basic test coverage.
- The old `src/modules/web-ui/` template-string approach is removed.
