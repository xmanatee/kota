---
id: task-kemp-health-check-message
title: Extend KEMP protocol with health_check message for foreign module health reporting
status: backlog
priority: p2
area: core
summary: Foreign modules only have ping/pong liveness. The new healthCheck protocol on KotaModule is unavailable to KEMP modules. Add a health_check request/health_status response so foreign modules can report degraded or unhealthy status with diagnostic details.
created_at: 2026-04-12T09:30:00Z
updated_at: 2026-04-12T09:30:00Z
---

## Problem

The module health check protocol was recently added to `KotaModule` (native
TypeScript modules can declare a `healthCheck` function returning `healthy`,
`degraded`, or `unhealthy` with detail text). The daemon probes these via
`probeHealthChecks()` and surfaces results on `/health` and `kota doctor`.

Foreign modules running over KEMP (stdio or HTTP transport) cannot participate.
They support `ping/pong` for basic liveness, but have no way to report nuanced
health state. A foreign module whose backing database connection has degraded,
or whose API key has expired, appears healthy because the subprocess is alive
and responding to pings.

## Desired Outcome

The KEMP protocol supports a `health_check` request message from KOTA and a
`health_status` response from the module. The foreign module loader translates
this exchange into the native `healthCheck` interface so the daemon treats
foreign and native module health identically.

## Constraints

- Follow the existing KEMP message conventions (`id`, `type`, correlation).
- `health_check` is optional — modules that do not respond within a short
  timeout (1s) are treated as healthy (same as native modules without
  `healthCheck`).
- Update `docs/FOREIGN-MODULES.md` with the new message pair.
- Do not change the native `healthCheck` contract.

## Done When

- KEMP `health_check` / `health_status` message pair is defined and documented.
- `foreign-module-stdio.ts` and `foreign-module-http.ts` send the request and
  parse the response.
- The foreign module loader wires the response into the native
  `HealthCheckResult` so `probeHealthChecks()` includes foreign modules.
- Tests cover: module reports healthy, module reports degraded with detail,
  module does not respond (timeout → assume healthy).
