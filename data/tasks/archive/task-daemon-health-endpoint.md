---
status: done
---

# Add GET /health endpoint to daemon control API

## Problem

`GET /status` returns comprehensive daemon state (active runs, sessions, queued tasks) but is heavyweight and may require auth. Container liveness/readiness probes need a minimal endpoint that returns quickly and signals whether the daemon is up and accepting requests. Without it, operators running KOTA in Docker or Kubernetes have to either disable health checks or repurpose `/status`, which is fragile.

## Desired Outcome

A new `GET /health` route on `DaemonControlServer` that:
- Returns HTTP 200 with a small JSON body when the daemon is running and its core subsystems are operational.
- Returns HTTP 503 if a critical subsystem (scheduler, module loader) has failed to initialize.
- Response shape:

```json
{
  "status": "ok" | "degraded",
  "version": "1.2.3",
  "uptimeMs": 12345,
  "components": {
    "scheduler": "ok" | "error",
    "modules": "ok" | "error"
  }
}
```

- No authentication required (unlike other daemon API routes).
- Documented in `docs/DAEMON-API.md` alongside existing routes.

## Constraints

- Keep the handler lean: no database queries, no heavy enumeration.
- `uptimeMs` is time since daemon start (use `process.hrtime` or `Date.now()` delta from startup).
- Module status is "ok" if all modules loaded without error; "error" + "degraded" overall if any failed.
- The route must not be gated behind any existing auth middleware that other routes use.

## Done When

- `GET /health` is registered in `daemon-control.ts` (or the appropriate split module).
- Returns 200 `{"status":"ok",...}` when daemon is healthy.
- Returns 503 `{"status":"degraded",...}` when a component reports error.
- `docs/DAEMON-API.md` includes the route.
- Unit test covers both healthy and degraded responses.
- Type-checking and linting pass.
