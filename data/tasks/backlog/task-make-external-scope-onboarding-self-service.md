---
id: task-make-external-scope-onboarding-self-service
title: Make external scope onboarding self service
status: backlog
priority: p1
area: architecture
task_class: Product
anchor: true
summary: Track the complete initiative that lets an operator add a folder once and have KOTA safely begin continuous work there.
created_at: 2026-07-31T16:13:00.617Z
updated_at: 2026-08-24T02:26:39.000Z
---

## Problem

KOTA can run against an externally supplied directory and has scope-aware
runtimes, policy, trust checks, operator scope selectors, and continuous scope
improvement. Those parts do not form a self-service product: live scopes cannot
be registered, trust/policy are not operator-mutable through the daemon,
`kota init` writes an unread legacy config file, and no shared client flow owns
onboarding and activation.

## Desired Outcome

An operator can select any suitable directory, inspect what KOTA needs, choose
a safe automation posture, add it to the live daemon, and observe continuous
scope improvement begin. The registration survives restart, every client
renders one shared semantic flow, and removing a scope stops KOTA without
deleting user data.

The initiative is delivered by these slices, in dependency order:

1. `task-complete-the-terminal-project-to-scope-migration`
2. `task-make-directory-scope-registration-a-live-daemon-li`
3. `task-make-scope-trust-and-policy-operator-mutable`
4. `task-add-one-transactional-external-scope-onboarding-se`
5. `task-replace-legacy-kota-init-with-scope-onboarding`
6. `task-expose-add-scope-through-the-shared-operator-surfa`
7. `task-activate-continuous-improvement-for-newly-onboarde`
8. `task-prove-self-service-external-scope-onboarding-end-t`

## Constraints

- `scope` and `scopeId` are the only KOTA-owned domain language. Complete the
  terminal migration first; do not retain `project` aliases or readers.
- Reuse one registry, runtime factory, policy resolver, trust boundary, setup
  system, UI contract, task queue, and continuous-improvement workflow.
- Delete obsolete or parallel paths as each slice replaces them. Do not add
  deprecation shims, fallback config formats, duplicate state machines, or
  client-owned orchestration.
- Default onboarding is non-destructive and propose/ask-only. Elevated trust
  and autonomous writes are explicit operator decisions.
- The initiative is not complete until the production operator flow proves
  live progress and restart/removal behavior end to end.

## Done When

- All eight listed slice tasks are done with their required evidence.
- There is one documented and enforced way to onboard, configure, activate,
  inspect, drain, and remove a directory scope.
- A new folder can begin continuous KOTA work without editing daemon startup
  code, hand-editing machine config, or restarting the daemon.
- Code and non-code scopes work through the same contracts without typed
  project categories.
- Final structural audit finds no `kota.config.ts` scaffold, second registry,
  programmatic-only scope-policy production path, or client-specific
  onboarding implementation.

## Source / Intent

Owner request on 2026-07-31: provide an easy mechanism in the daemon/operator
interface to add other folders and start automated continuous improvement in
them, including any preparation of agents, tasks, or workflows that evidence
shows is necessary. The owner asked for tasks now rather than immediate code
changes and emphasized one generalized mechanism over repeated client
implementations.

## Initiative

Self-service external scope onboarding.

## Acceptance Evidence

- The acceptance artifacts from every listed slice are linked from this
  anchor's final result.
- A final operator walkthrough adds, configures, observes, restarts, and removes
  both a code and non-code external scope.
- The final architecture search report demonstrates the single-mechanism
  invariants named in Done When.
