---
id: task-expose-add-scope-through-the-shared-operator-surfa
title: Expose Add Scope through the shared operator surface
status: backlog
priority: p1
area: client
task_class: Product
depends_on: [task-add-one-transactional-external-scope-onboarding-se, task-make-ui-contributions-the-only-surface-assembly-pa, task-generate-client-bindings-from-the-daemon-ui-contra]
summary: Add one semantic onboarding surface and generated client actions for inspecting, configuring, adding, and removing directory scopes.
created_at: 2026-07-31T16:12:55.650Z
updated_at: 2026-08-24T02:26:39.000Z
---

## Problem

Operator clients can list and select known scopes, but none can add one. The
CLI lacks a complete scope lifecycle, and the daemon API only exposes read
routes plus active selection. Implementing bespoke forms and commands now would
repeat onboarding semantics across terminal, web, mobile, and Apple clients.

## Desired Outcome

Contribute one live Add Scope/onboarding surface through `ui.surface.v1`. It
renders the canonical inspection, plan choices, trust/policy implications,
setup gaps, apply progress, readiness, retry/cancel, and safe remove actions.
All clients invoke generated bindings for the same daemon actions.

Provide `kota scope inspect|add|status|remove` as a terminal client of those
same operations. Selection and listing also use the canonical `scope` command;
the retired `project` command is absent rather than retained as an alias.

## Constraints

- Depend on the module-owned UI contribution and generated binding work; do
  not hand-maintain parallel TypeScript/Swift onboarding models.
- The semantic action accepts a daemon-host path. Native clients may populate
  it with the platform folder picker. CLI accepts an explicit path. A remote
  browser must use explicit path entry or a constrained daemon-side directory
  browser; browser file APIs do not reveal an arbitrary host path.
- Renderers own platform presentation only. They must not choose defaults,
  compute readiness, mutate trust, scaffold files, or start automation.
- Surface permissions, destructive scope removal, validation errors, and
  unavailable capabilities explicitly.
- A remove action stops KOTA hosting the scope and never implies deleting the
  folder.

## Done When

- The shared scope surface includes add, inspect, configure, apply, status,
  retry/cancel, select, drain, and remove actions from one domain contract.
- CLI, web, mobile/Android, macOS, and iOS consume generated contract bindings;
  local native clients provide a folder picker without changing semantics.
- The flow clearly distinguishes untrusted/propose-only defaults from explicit
  trust or autonomous-write choices.
- Progress survives client disconnect/reconnect through operation status, not
  client-local state.
- No client contains its own onboarding workflow or filesystem mutation path.

## Source / Intent

Owner request on 2026-07-31: expose Add Project in a convenient daemon/operator
interface, allow selecting a folder and configuring required settings, then
start work. This follows the owner's broader requirement that UI semantics be
defined once and rendered by each client rather than reimplemented.

## Initiative

Self-service external scope onboarding.

## Acceptance Evidence

- CLI transcript and projected web/mobile/Apple rendered artifacts show the
  same onboarding operation, choices, errors, and final readiness.
- A native rendered fixture demonstrates system folder-picker path handoff to
  the shared action; a web fixture demonstrates explicit host-path handling.
- A structural artifact shows no client-owned onboarding state machine or
  direct registry/config writer.
