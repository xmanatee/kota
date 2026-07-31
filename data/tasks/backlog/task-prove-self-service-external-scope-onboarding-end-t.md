---
id: task-prove-self-service-external-scope-onboarding-end-t
title: Prove self-service external scope onboarding end to end
status: backlog
priority: p1
area: architecture
task_class: Product
depends_on: [task-replace-legacy-kota-init-with-scope-onboarding, task-expose-add-scope-through-the-shared-operator-surfa, task-activate-continuous-improvement-for-newly-onboarde]
summary: Demonstrate live onboarding, autonomous progress, restart recovery, isolation, and safe removal for external code and non-code scopes.
created_at: 2026-07-31T16:12:58.650Z
updated_at: 2026-07-31T16:12:58.650Z
---

## Problem

Earlier external-project and multi-scope tasks proved programmatic daemon
configuration and isolated fixture workflows. They did not prove the owner
journey requested here: add a previously unknown folder through an operator
surface, configure it, see autonomous progress without restart, recover it
after restart, and stop hosting it without harming its files.

Without this closure slice, foundational tasks could pass independently while
the complete product remains unusable or relies on a hidden manual step.

## Desired Outcome

Produce one end-to-end acceptance fixture and inspectable operator artifacts
for two external scopes:

- An existing Git code repository that is onboarded in propose/task mode and
  completes one normal task-backed improvement.
- A non-code directory that is onboarded in observe/ask mode and produces an
  evidence-backed recommendation or owner question without code assumptions.

The proof covers live add, selection, readiness, first automation, isolation,
restart recovery, drain/remove, and preservation of the target directories.

## Constraints

- Exercise production daemon routes, client contract, onboarding service,
  registries, and existing workflows. Do not inject `DaemonConfig.projects`
  or call internal factories directly in place of the operator flow.
- Keep target fixtures outside the KOTA repository and give each distinct
  runtime/task/run state.
- Do not count a task created without later dispatch eligibility, a scheduled
  run that never executes, or a client-only mock as autonomous progress.
- Include negative paths for duplicate/symlink identity, missing setup,
  malicious repo-local config, active-work removal, failed apply/retry, and
  restart during onboarding.
- Verify no project data, trust, policy, worktree, claim, event, or backoff
  crosses scope boundaries.

## Done When

- The full operator flow succeeds for both fixture kinds without daemon
  restart between add and first work.
- At least one real scoped workflow completes after onboarding and its durable
  artifact, task state, and file effects are attributable to that scope.
- Restart restores both registrations, policy/readiness, schedules, and
  operation history without duplicates.
- Draining/removing one scope leaves the sibling running and leaves every
  target file intact.
- Structural validation finds no alternate registry, init/scaffold,
  trust/policy mutation, onboarding state machine, or client-specific
  activation path.

## Source / Intent

Owner request on 2026-07-31: make adding other folders convenient and make
automated continuous improvement actually begin there. This closure task is
needed because prior `task-prove-external-project-autonomy-with-end-to-end-fi`
proved only a daemon booted directly with an external `projectDir`.

## Initiative

Self-service external scope onboarding.

## Acceptance Evidence

- A complete CLI transcript plus projected client artifacts from Add Scope to
  first completed work for both fixtures.
- Daemon/runtime artifacts before add, after activation, after restart, and
  after removal showing registry, policies, schedules, runs, claims, and scope
  isolation.
- Before/after hashes of both external directories proving removal preserved
  user data, plus a structural single-mechanism search report.
