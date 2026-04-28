---
id: task-unify-module-route-protocols
title: Unify module route protocols
status: backlog
priority: p2
area: architecture
summary: Converge public module routes and daemon-control routes on one typed route registration protocol with shared parameter extraction, auth posture, capability scope, and request/response validation.
created_at: 2026-04-28T22:24:00.000Z
updated_at: 2026-04-28T22:24:00.000Z
---

## Problem

KOTA currently has two similar but inconsistent module route protocols:

- `RouteRegistration` uses `path`, optional `pathPattern?: RegExp`, and
  requires handlers to extract params themselves.
- `ControlRouteRegistration` uses `:name` path segments, extracts params in
  the router, and carries `capabilityScope`.

This duplicated shape creates protocol drift and makes route contributions
harder to validate. The daemon-control route shape is cleaner and should be
the baseline for public routes as well, with explicit auth posture where
needed.

## Desired Outcome

One shared module route registration protocol covers both public HTTP routes
and daemon-control routes:

- `:param` path matching with router-provided params.
- Explicit auth mode / bypass posture with required justification for bypass.
- Explicit capability or surface scope where relevant.
- Optional request/response schemas for protocol-bearing JSON routes.
- Collision detection and focused tests for both route surfaces.

## Constraints

- Do not add a second public API surface. This is a registration protocol
  cleanup, not a route migration to new URLs.
- Preserve existing paths and behavior unless a route is already broken.
- Provider-specific webhook routes that bypass bearer auth must retain their
  signature validation model.
- Coordinate with cross-client daemon contract work so schemas/fixtures do not
  diverge.

## Done When

- `RouteRegistration` and `ControlRouteRegistration` share one underlying
  typed route descriptor or route-builder protocol.
- Public module routes can receive router-extracted params without regex/manual
  parsing.
- Existing route tests cover path params, collision rejection, auth bypass, and
  capability scope for contributed routes.
- Scoped `AGENTS.md` in `src/core/modules/` or `src/core/daemon/` describes the
  single route contribution model.

## Source / Intent

2026-04-28 review found the route inconsistency in
`src/core/modules/module-types.ts`: public routes use manual regex matching;
daemon-control routes use structured param extraction and capability scope.

External comparison:

- MCP exposes protocol messages with clear method names, params, capabilities,
  and error handling. KOTA route contribution should have the same clarity.

## Initiative

Protocol simplification: reduce duplicate route mechanisms so module-owned
HTTP surfaces are easier to add, validate, and consume from clients.

## Acceptance Evidence

- A fixture module contributing both a public route and control route through
  the unified descriptor.
- Tests proving URL params arrive identically on both surfaces.
- Existing public and daemon-control route tests remain green.

