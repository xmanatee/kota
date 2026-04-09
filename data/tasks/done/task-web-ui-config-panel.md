---
id: task-web-ui-config-panel
title: Add config viewer panel to web UI
status: done
priority: p3
area: operator-experience
summary: Operators have no way to view or understand the active resolved config from the web UI. A read-only config panel showing the current merged config (global + project) would help operators diagnose setup issues without switching to the CLI.
created_at: 2026-04-02T10:41:13Z
updated_at: 2026-04-02T11:49:09Z
---

## Problem

KOTA's config is spread across two JSON files (global `~/.kota/config.json` and project `.kota/config.json`) merged at runtime. Operators debugging unexpected behavior — wrong model, missing module, bad budget — have to run `kota config validate` from the CLI to see the resolved config. The web UI provides no config visibility at all.

This creates friction for operators who are primarily using the web UI and don't have a terminal handy, and makes the web UI feel incomplete relative to the CLI.

## Desired Outcome

A Config panel in the web UI sidebar (or a dedicated section) that:

- Fetches and displays the current resolved config via a daemon API route.
- Renders it as a collapsible JSON tree or syntax-highlighted code block.
- Labels the source of each top-level key (global vs project override) when inferable.
- Refreshes on demand with a reload button.

The panel is read-only — no editing. Config writes stay in the CLI (`kota config set`).

## Constraints

- The daemon API must expose a `GET /api/config` endpoint returning the resolved config (omitting secrets: mask fields matching `token`, `secret`, `password`, `key` patterns).
- The web UI must not expose raw secret values — mask sensitive fields on the server side before sending to the client.
- No new npm dependencies.
- If the daemon is offline, the panel shows a "daemon not running" placeholder.

## Done When

- `GET /api/config` returns the resolved merged config with sensitive fields masked.
- The web UI Config panel fetches and renders the config.
- Sensitive fields (token, secret, password, api_key) are masked to `"***"` in the response.
- The panel renders without errors when the daemon is running and when it is offline.
