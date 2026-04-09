---
id: task-kemp-http-bearer-auth
title: Add bearer token authentication to the KEMP HTTP transport
status: done
priority: p3
area: runtime
summary: The KEMP HTTP transport sends bare POST requests with no authentication. Any process that can reach the foreign module URL can invoke it. Adding optional bearer token auth protects deployed foreign modules from unauthorized callers.
created_at: 2026-03-31T06:42:08Z
updated_at: 2026-03-31T08:16:57Z
---

## Problem

`HttpTransport` in `src/foreign-module-http.ts` sends all KEMP requests as plain JSON
POSTs with no `Authorization` header. If the foreign module HTTP server is reachable
from outside the local machine (e.g., a remote service, a Docker sidecar on a shared
network, or a cloud function), any caller can invoke its tools without authentication.

There is no config field to supply a shared secret or bearer token, and the transport
makes no attempt to authenticate.

## Desired Outcome

- `HttpForeignModuleConfig` gains an optional `bearerToken?: string` field.
- When set, `HttpTransport` sends `Authorization: Bearer <token>` on every request.
- The secret can be supplied as a string literal or as a reference to an environment
  variable (e.g., `{ env: "MY_EXT_SECRET" }`), following the existing pattern for
  secrets in module config.
- When omitted, the transport is unchanged (backward-compatible).

## Constraints

- Only the HTTP transport is affected; stdio transport is unchanged.
- Do not log the token value in error messages or diagnostic output.
- Document the new config field in `docs/FOREIGN-MODULES.md` under the HTTP transport
  section.
- No changes to the KEMP protocol envelope or message types.

## Done When

- `HttpForeignModuleConfig.bearerToken` is accepted and validated.
- When configured, the `Authorization: Bearer` header is sent on all HTTP requests.
- The token value is not exposed in logs or error output.
- At least one unit test covers the header being sent when configured and absent when not.
- `docs/FOREIGN-MODULES.md` documents the new field.
