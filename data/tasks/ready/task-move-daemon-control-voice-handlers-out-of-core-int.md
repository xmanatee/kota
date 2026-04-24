---
id: task-move-daemon-control-voice-handlers-out-of-core-int
title: Move daemon-control voice handlers out of core into the voice module
status: ready
priority: p2
area: architecture
summary: Remove daemon-control-voice.ts (and its #modules/voice/* imports) from src/core/ by letting modules contribute to the daemon-control route table with a capability scope; the voice module registers /voice/transcribe and /voice/synthesize itself.
created_at: 2026-04-24T08:40:34.936Z
updated_at: 2026-04-24T08:40:34.936Z
---

## Problem

After the Anthropic-type audit and the execution-module extraction, core still
reaches back into the voice module from production code:

- `src/core/daemon/daemon-control-voice.ts` imports `synthesizeSpeech`,
  `transcribeVoice`, and five voice error / format types from
  `#modules/voice/service.js` and `#modules/voice/types.js`.
- `src/core/daemon/daemon-control.ts` imports the two exported handlers and
  hard-codes `/voice/transcribe` and `/voice/synthesize` in the `ROUTE_SCOPES`
  map plus the request-dispatch switch.
- `src/core/daemon/daemon-control-voice.test.ts` exists only to exercise those
  core-hosted handlers.

This is the same boundary violation the recent "eliminate remaining core →
execution-module imports" task closed for code execution: the daemon-control
HTTP server — a core-owned control plane — pulls module-specific behavior into
core because the core-side route table has no contribution seam for the
daemon-control surface. The voice module already owns an `/api/voice/*` route
registration through `KotaModule.routes` on the `kota serve` session-pool
server, but the daemon-control server (used by the macOS and mobile clients
through `/voice/transcribe` and `/voice/synthesize`) has no equivalent seam.
As a result, every new module-owned capability that needs a control-plane
endpoint has to land its handler under `src/core/daemon/`, import the module,
and edit the hard-coded route table. That inverts core's boundary.

## Desired Outcome

No `src/core/**/*.ts` file imports from `#modules/voice/**` in production
code. The voice module registers `/voice/transcribe` and `/voice/synthesize`
on the daemon-control server itself, with the same request shape and response
semantics clients already rely on. A module-contribution seam lets future
module-owned control-plane endpoints plug in without touching core. The
existing macOS / mobile / mobile-test paths keep working against the same
URLs.

## Constraints

- Pick one mechanism. Either (a) widen `RouteRegistration` with an optional
  `capabilityScope: "read" | "control"` field and have the daemon-control
  server accept module-contributed routes in the same shape modules already
  use for `kota serve`, or (b) add a distinct `ControlRouteRegistration` type
  and a separate module contribution point on `KotaModule`. Do not ship both
  and do not leave a parallel duplicated voice-route path living in core as a
  shim. Record the decision in the run directory.
- The capability-scope metadata must be carried by the module contribution,
  not by a hard-coded lookup in `ROUTE_SCOPES` keyed on path strings. The
  hard-coded voice entries in `ROUTE_SCOPES` go away as part of this task.
- Do not change the `/voice/transcribe` or `/voice/synthesize` wire format —
  request body shape, success/error envelopes, and status codes must stay
  identical so macOS (`clients/macos`), mobile (`clients/mobile`), and their
  tests keep passing unchanged.
- Keep the strict 16 MiB body cap, empty-body rejection, JSON parse
  rejection, base64 decode rejection, missing-field 400s, and the `stt-*` /
  `tts-*` error codes — they are the external contract.
- Do not introduce new nullable fields on the module contribution type. If
  the capability scope is needed on every control-plane route, it is
  required, not optional.
- No test-only production flags, hooks, or override parameters. The voice
  module's tests should exercise the registered routes through the same
  registration seam real clients use.
- Respect `src/modules/AGENTS.md` — if the voice module starts contributing
  to daemon-control routes, that belongs alongside its existing
  `routes: () => voiceRoutes()` contribution, not in a sibling module.
- Keep the core → module direction clean on the way out: after this task the
  only remaining `src/core/**` → `#modules/voice/**` references should be
  zero (verified by a mirror of the existing import-guard pattern).

## Done When

- `src/core/**/*.ts` has zero production imports from `#modules/voice/**`.
  `src/core/daemon/daemon-control-voice.ts` and its co-located test file are
  gone; the two voice entries in `ROUTE_SCOPES` and the two dispatch cases in
  `daemon-control.ts` are gone with them.
- The voice module contributes `/voice/transcribe` and `/voice/synthesize`
  (with `capabilityScope: "control"`) to the daemon-control server through
  the chosen module-contribution seam. The contributed handlers enforce the
  same request / response / error contract the core-hosted handlers enforce
  today, covered by unit tests co-located with the voice module.
- A new import-guard test under `src/core/` walks `src/core/**/*.ts` and
  fails the suite if a future change reintroduces a `#modules/voice` import,
  matching the existing `no-anthropic-imports-in-core.test.ts` and
  `no-execution-module-imports-in-core.test.ts` guards.
- Existing `clients/macos` and `clients/mobile` daemon-client tests that
  assert against `/voice/transcribe` and `/voice/synthesize` continue to
  pass unchanged; the `kota serve` `/api/voice/*` path continues to work
  through the same voice module (no duplication between the two
  registrations).
- The chosen contribution seam is documented in one or two sentences at the
  narrowest applicable `AGENTS.md` (most likely
  `src/core/modules/AGENTS.md` or `src/core/daemon/AGENTS.md`) so the
  pattern is discoverable for the next module-owned control-plane endpoint
  (history, workflow, webhooks) without reading this task.
- If the chosen approach needs a new protocol field, the `KotaModule` /
  `RouteRegistration` type change, including the `capabilityScope` meaning,
  is documented at the module-types level — not duplicated across module
  `AGENTS.md` files.
