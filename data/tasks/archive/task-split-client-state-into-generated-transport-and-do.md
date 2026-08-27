---
status: done
---

# Split client state into generated transport and domain stores

## Problem

Apple `AppState`, mobile daemon/context state, and related client aggregates
mix transport decoding, connection lifecycle, scope selection, sessions,
tasks, setup, approvals, shared UI, polling, and presentation coordination.
Large state owners duplicate domain joins and make generated contracts harder
to adopt cleanly.

## Desired Outcome

After scope and contract generation land, refactor clients around generated
wire contracts plus focused domain stores for connection/readiness, scope,
sessions, tasks/workflows, setup/approvals, and shared UI. A thin application
coordinator composes those stores without becoming a second daemon model.

## Constraints

- Preserve native SwiftUI, React Native, and web presentation; only semantic
  transport/state ownership is shared through generated contracts.
- Clients never read `.kota/`, reconstruct daemon authority, or maintain a
  parallel capability inventory.
- Domain stores subscribe to daemon events through one client transport and
  expose explicit loading, ready, unavailable, and error states.
- Remove copied decoders and old aggregate-owned state as each client moves;
  no permanent forwarding properties or duplicate stores remain.
- Keep keyboard, touch, narrow-screen, light/dark, and reduced-motion behavior
  intact for operator surfaces.

## Done When

- Apple, mobile, and web use generated wire contracts and focused domain state
  owners with a small composition root.
- Scope switching invalidates and reloads only scope-owned state; daemon-global
  state remains stable.
- Reconnect, restart, stale response, cancellation, and partial capability
  readiness have deterministic tests.
- Old aggregate-owned domain logic, hand decoders, and duplicate projections
  are removed.

## Source / Intent

Owner-approved client-architecture rewrite from the 2026-08-24 audit. Static
UI review found good accessible rendering; this task preserves that quality
while cleaning transport and state ownership.

## Initiative

Thin native clients over one daemon contract.

## Acceptance Evidence

- Cross-client state/reconnect fixtures using the same generated daemon
  envelopes.
- Rendered web/mobile/Apple evidence for scope switch, loading, unavailable,
  error, and recovered states.
- Dependency report proving client domain stores do not reproduce daemon
  authority or authored wire schemas.

## Result

Apple and React Native now expose connection, scope/activity, requested
content, and shared-UI state through focused domain values. Their composition
roots coordinate transport without forwarding the former flat aggregate
fields. Scope changes retain daemon-global approvals, questions, and task
state, clear only scope-owned activity and live content, preserve operator
drafts, and reject late completions from the previous scope. Web already used
TanStack Query plus `ScopeContext`; its single `DaemonEventSource` remains the
event owner.

The generated TypeScript client now publishes namespace-port types. Config,
history, setup routing, operator inbox, and Telegram scope selection consume
only their declared namespaces. Mobile screen fixtures no longer repeat the
entire application state, and decoder boundary tests assert the public
`ContractDecodeError` instead of generated error wording. Each platform has
one connection-level event stream owner; chat streaming remains a separate
request response protocol rather than a second application event subscriber.

Generator freshness, repository lint, production/test typechecks, and 51
focused server tests passed. Mobile typecheck and all 378 selected tests,
Apple's 239 tests, and all 75 web tests plus its production build passed.
