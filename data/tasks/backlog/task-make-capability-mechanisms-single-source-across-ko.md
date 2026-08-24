---
id: task-make-capability-mechanisms-single-source-across-ko
title: Make capability mechanisms single-source across KOTA
status: backlog
priority: p1
area: architecture
task_class: Platform
anchor: true
summary: Track the decomposed initiative to give every cross-client and integration capability one canonical declaration and execution path.
created_at: 2026-07-31T16:01:03.656Z
updated_at: 2026-08-24T02:26:39.000Z
---

## Problem

KOTA's architecture states that each job should have one clear mechanism, but
the audit found important exceptions: live UI surfaces use both static module
contributions and a manual daemon bundle; web/Apple/mobile own separate
operator inventories; wire decoders are copied or mirrored; outbound HTTP is
implemented across many modules; and remote task providers repeat an
unobservable fire-and-forget mutation algorithm.

At the same time, browser automation, module/tool registration, and the
slash-command catalog already have clear owners. The initiative must repair
the proven exceptions without replacing sound boundaries or pretending native
renderers can share presentation code across SwiftUI, React, React Native, and
terminal output.

## Desired Outcome

Every audited cross-client or integration capability has one authored semantic
contract, one registration/assembly path, and one execution policy. Platform
clients remain native thin renderers. Generated code and vendor adapters are
derived implementations, not independent sources of truth.

## Constraints

- This is a strategic anchor. Implement only the listed sub-slice tasks; never
  promote or execute this file as one broad refactor.
- Remove superseded mechanisms in the same initiative. No deprecation layer,
  legacy fallback, parallel catalog, or indefinite compatibility mode.
- Do not unify boundaries that have different responsibilities: HTTP is not
  browser automation, semantic UI is not native visual styling, and module
  registration is not client rendering.
- Preserve the already-canonical `browser`, module loader/tool registry,
  command catalog, and terminal rendering ownership models. Replace the
  hand-authored core `KotaClient` aggregate with generated module-owned client
  contracts; do not preserve its core import exception.
- Prefer typed protocols, generated bindings, module contributions, and
  deterministic fitness checks over a new recurring audit agent.

## Done When

- `task-make-ui-contributions-the-only-surface-assembly-pa` is done.
- `task-generate-client-bindings-from-the-daemon-ui-contra` is done.
- `task-render-shared-ui-surfaces-in-the-web-client` is done.
- `task-render-shared-ui-surfaces-in-apple-clients` is done.
- `task-render-shared-ui-surfaces-in-android-mobile` is done.
- `task-generate-all-thin-client-daemon-contract-bindings` is done.
- `task-add-one-policy-aware-outbound-http-transport` is done.
- `task-migrate-integrations-to-the-outbound-http-transpor` is done.
- `task-make-remote-task-provider-mutations-durable` is done.
- `task-enforce-single-mechanism-architecture-boundaries` is done.
- Final evidence maps every audited capability to one authority and shows all
  superseded paths removed.

## Source / Intent

Owner request on 2026-07-31: audit the entire tool for one correct way to
declare and perform each capability, especially internet/browser access,
daemon interfaces across terminal/web/desktop/mobile, and component
registration. Create tasks now so KOTA autonomy can implement the repairs;
do not perform the refactor or add a recurring agent in this turn.

## Initiative

One canonical capability mechanism per KOTA boundary.

## Acceptance Evidence

- A final architecture ownership matrix generated from code-owned manifests,
  schemas, and transport profiles, not a manually maintained duplicate catalog.
- Cross-client rendered evidence for one shared daemon bundle and generated
  wire-contract evidence for every supported client.
- HTTP/task-provider migration inventories and architecture fitness-check
  output showing no alternate implementation paths remain.
