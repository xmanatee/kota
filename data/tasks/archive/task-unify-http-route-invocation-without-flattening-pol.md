---
status: done
---
# Unify HTTP route invocation without flattening policy

## Problem

At 763e14b14 serve and daemon share route declarations/matching but not invocation.
core/server/server-routes.ts invokes handler inside Promise.resolve, so a
synchronous throw escapes its rejection handler. core/daemon/daemon-control-
route-invoker.ts handles both sync and async failure. Authorization also differs:
serve checks /api/ and accepts a GET query token; daemon has route-level and
dashboard guards. Those differences need explicit ownership, not copied dispatch.

## Desired Outcome

Use one narrow route invocation/error boundary in both hosts, covering normal
handlers and auth-failure handlers. Preserve intentional host-specific authority
through clear policy inputs/owners rather than pretending both hosts are identical.
Trace all contributed routes and direct host routes before deciding the scope of
reuse. An abstraction should make the safe path natural, not require each module
to repeat try/catch and authentication wiring.

## Constraints

Retain established route registration, matching, scope selection and generated
clients. Do not create another router or auth protocol. Do not weaken webhook
signature checks, dashboard restrictions or token handling. A separate security
change needs explicit evidence; identical policy everywhere is not the objective.
Delete the replaced invocation path and redundant private-helper tests.

## How We Will Know

Through both production dispatchers, synchronous throws and rejected promises
produce the intended failure response without an uncaught process failure or
double response. Unauthorized calls remain rejected; intentional webhook and
dashboard behavior stays distinct. Test common invocation behavior once and keep
only host-specific authority scenarios. A call-site scan finds one invocation
mechanism and explicit policy differences, not wrappers around copied logic.