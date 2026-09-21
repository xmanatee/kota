---
status: open
priority: p1
---
# Bind Google Workspace token caching to each configured tool set

## Problem

The process-global token cache can substitute one configured account's bearer for another account's Google requests. Tool registration captures distinct credentials but does not own cached authentication state. Readiness independently verifies the requested credentials and can report ready despite execution using another account. Existing auth tests avoid shared-state contamination by advancing time between tests.

Investigation: Tracing the newly changed Calendar tool uncovered an independent token-ownership defect. Google Workspace creates credential-specific tool closures, but auth.ts caches one access token process-wide and checks only expiry before reuse. A controlled production-tool probe showed account B's readiness refresh succeeding while B's Calendar request used account A's cached bearer; newly configured account C also used A's bearer. All seven Google tools share this path. No live-account exposure or external mutation was observed. Active-task searches found no overlapping repair. Calendar pagination remains locally owned; its source and archived completion record do not justify further abstraction. Previously settled scanner observations were not reassessed, and no causal connection to supplied delivery issues was established.

Evidence:
- git:e0a33ff11faf1de26c049bb914163395f6a78a5a
- docs/STANDARDS.md
- docs/ARCHITECTURE.md
- src/core/modules/module-context.md
- src/core/modules/runtime-module-discovery.ts
- src/core/modules/module-loader-load-phases.ts
- src/modules/google-workspace/AGENTS.md
- src/modules/google-workspace/auth.ts
- src/modules/google-workspace/auth.test.ts
- src/modules/google-workspace/index.ts
- src/modules/google-workspace/index.test.ts
- src/modules/google-workspace/capability-readiness.ts
- src/modules/google-workspace/calendar.ts
- src/modules/google-workspace/calendar.test.ts
- src/modules/google-workspace/gmail.ts
- src/modules/google-workspace/drive.ts
- data/tasks/archive/task-google-workspace-module.md
- data/tasks/archive/task-add-google-workspace-module-tests.md
- data/tasks/archive/task-split-google-workspace-module.md
- data/tasks/archive/task-preserve-calendar-list-completeness.md
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t06-08-03-328z-archite-2114b6aa2cfb77f03308f8b7036b590cf276856a359dd914b7f912712569c505/agent/google-token-ownership-probe.mjs
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t06-08-03-328z-archite-2114b6aa2cfb77f03308f8b7036b590cf276856a359dd914b7f912712569c505/agent/google-token-ownership-transcript.json
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t06-08-03-328z-archite-2114b6aa2cfb77f03308f8b7036b590cf276856a359dd914b7f912712569c505/agent/investigation.md

## Desired Outcome

Each configured Google tool set uses only its own credentials and cached token, including after another configuration executes or a module is reloaded. Gmail, Calendar and Drive retain token reuse within their owning tool set. Expected benefits are correct account selection and simpler authentication lifetime ownership; these remain unverified until implemented.

This is an unverified expectation, not a measured improvement.

Maintained consumers:
- Gmail list, get and send tools
- Calendar list and create tools
- Drive list and read tools
- Google Workspace OAuth readiness and module configuration/reload

Alternatives considered:
- Leave the implementation unchanged: rejected by the reproduced cross-account bearer reuse.
- Remove caching entirely: eliminates shared state but loses useful token reuse.
- Use a process-wide credential-keyed map: separates credentials but adds retention and lifetime management.
- Prefer a credential-bound cached getter shared by one configured tool set, using the existing module-local refresh implementation.

Migration and retirement: Move cached-token state into the configured getter created for Google Workspace tools. Migrate all seven consumers through their existing getToken callback. Remove the process-global cache and its stateless-looking cached access API. Preserve readiness's fresh credential verification. Replace tests' global-cache time-jumping workaround with independently owned fixtures; retain distinct refresh, expiry, request and failure checks.

Common behavior: Refresh and reuse an OAuth access token for tools sharing one resolved Google credential configuration.
Stable variation point: The owning credential configuration and existing HTTP request port; service URLs and payload behavior remain with Gmail, Calendar and Drive.
Canonical owner: src/modules/google-workspace/auth.ts, instantiated by the configured tool factory in index.ts

## Constraints

Preserve the maintained consumers' domain-specific behavior.

## How We Will Know

Exercise actual registered tools with controlled HTTP responses for two credential configurations, repeated calls, interleaving, expiry, refresh failure and replacement configuration. Verify outgoing bearer identity and returned account-specific results. Include readiness followed by execution and a normal reload journey. Preserve write-effect classifications, secret containment and Calendar completeness behavior. Retain a synthetic tool transcript; no live account is required.

Show that one configured getter owns token lifetime, all seven tools share that getter, and no process cache, reset API or credential-keyed global registry remains. Demonstrate independent test fixtures without cross-test expiry manipulation.

Record actual migrated callers, retired paths and the simpler result in this task's completion evidence. The gardener follows this task; expected benefits alone do not establish success.
