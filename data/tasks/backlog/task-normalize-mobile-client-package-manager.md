---
id: task-normalize-mobile-client-package-manager
title: Normalize the mobile client package manager to pnpm
status: backlog
priority: p3
area: clients
summary: The root repo standard prefers pnpm, but the mobile client still has alternate package-manager guidance and a tracked package-lock.json.
created_at: 2026-04-13T11:16:25Z
updated_at: 2026-04-13T11:16:25Z
---

## Problem

The root project uses pnpm and the standards document says to use pnpm for
package scripts, dependency installation, and one-off package execution. The
mobile client has `package-lock.json` tracked and its README still tells users
to install dependencies through a different package manager.

This creates unnecessary package-manager drift in a repo that otherwise tries
to keep tooling choices explicit.

## Desired Outcome

The mobile client follows the repo package-manager convention or documents a
strong reason for being an exception. If there is no exception, alternate
lockfiles and install guidance are removed or converted to pnpm.

## Constraints

- Do not change mobile runtime behavior.
- Do not regenerate dependencies unless necessary.
- Do not leave both package-manager lockfiles for the same client.
- Keep client docs concise.

## Done When

- Mobile client setup instructions use pnpm or justify a deliberate exception.
- Tracked alternate lock artifacts are removed if pnpm is used.
- The root pnpm standard and client docs no longer conflict.
- Git status contains no untracked dependency directories from the cleanup.
