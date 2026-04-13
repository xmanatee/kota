---
id: task-structure-web-ui-module-subdomains
title: Structure web-ui into client and rendering subdomains
status: backlog
priority: p2
area: web-ui
summary: The web-ui module has many flat client and style files, making the UI surface harder to navigate and evolve.
created_at: 2026-04-13T11:16:25Z
updated_at: 2026-04-13T11:16:25Z
---

## Problem

`src/modules/web-ui/` has a broad collection of flat files: client panels,
run-detail helpers, workflow UI code, markdown rendering, style fragments, and
server-side HTML assembly. The module boundary is correct, but the internal
layout does not reflect the UI subdomains.

This increases friction for future UI work and makes it easy to add more
top-level files instead of extending a coherent area.

## Desired Outcome

The web-ui module is internally organized around clear UI subdomains such as
client panels, run-detail views, styles, and server/rendering helpers. The web
module continues to consume the web UI through one clear public entry point.

## Constraints

- Do not change UI behavior as part of the structural move.
- Do not add compatibility files that merely re-export old paths.
- Keep the web module thin and avoid moving web-ui internals into core.
- Preserve existing tests by moving them with the code they cover.

## Done When

- Web-ui no longer reads as one flat bucket of client and style files.
- The web module imports only the intended public web-ui entry point.
- Local documentation describes the internal structure without listing every file.
- Existing web-ui tests cover the moved code paths.
