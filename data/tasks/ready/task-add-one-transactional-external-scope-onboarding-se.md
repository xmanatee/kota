---
id: task-add-one-transactional-external-scope-onboarding-se
title: Add one transactional external scope onboarding service
status: ready
priority: p1
area: architecture
task_class: Platform
depends_on: [task-complete-the-terminal-project-to-scope-migration, task-make-scope-trust-and-policy-operator-mutable]
summary: Create the sole inspect-plan-apply onboarding transaction for validating, configuring, registering, and activating a directory scope.
created_at: 2026-07-31T16:12:51.436Z
updated_at: 2026-08-26T23:41:11.443Z
---

## Problem

KOTA's underlying external-scope, trust, setup, policy, and continuous
improvement capabilities are separate low-level mechanisms. There is no single
operation that tells an operator what a selected folder needs, records their
choices, prepares only the missing scope state, registers the runtime, and
reports whether autonomous work is actually ready.

Adding routes or client-specific setup scripts directly would recreate this
orchestration several times and make partial onboarding failures hard to
recover.

## Desired Outcome

Add one typed onboarding service with explicit `inspect`, `plan`, and `apply`
phases:

- `inspect` resolves the real directory, identifies existing KOTA/task/git
  state, trust, policy, local guidance, setup gaps, and whether it is already
  registered.
- `plan` validates operator choices and returns the exact machine-owned and
  scope-owned changes, permissions, blockers, and initial automation mode.
- `apply` executes the accepted plan transactionally, registers the scope,
  initializes only required files, and returns one readiness projection.

The operation must be idempotent and resumable: repeating the same accepted
plan returns the same scope rather than creating duplicate state.

## Constraints

- This service is the only onboarding orchestrator. CLI, daemon routes, and UI
  delegate to it rather than composing lifecycle/config/setup calls
  independently.
- Reuse `ScopeRegistry`, the canonical scope runtime host, scope policy, scope
  trust, setup requirements, repo-task scaffolding, and `scope-improver`; do
  not add a new scope category, setup framework, task store, or automation loop.
- Do not infer elevated trust or autonomous write permission. The default plan
  is untrusted, inspect/propose-only, with no autonomous write paths.
- Separate inspection from mutation. Merely selecting or inspecting a folder
  must not write files, trust it, start workflows, or register it.
- Scope-owned writes are declared in the plan and applied atomically where
  possible. A failure returns a durable incomplete disposition and leaves no
  live runtime claiming readiness.
- Support valid non-Git/non-code directories; report capability-specific
  blockers instead of assuming every scope is a software repository.

## Done When

- The service exposes typed inspect, plan, apply, status, and retry/cancel
  operations with stable operation ids.
- The readiness projection distinguishes registered, configured, trusted,
  workflow-ready, blocked, and partially applied states with actionable
  reasons from existing setup/policy mechanisms.
- Applying the same plan twice does not duplicate registry entries, files,
  schedules, triggers, tasks, or audit records.
- A failed apply can be retried or rolled back without manual filesystem or
  registry repair.
- Both an existing repository and an empty directory can be onboarded through
  the same domain service with different resulting capability readiness.

## Source / Intent

Owner request on 2026-07-31: choose another folder, configure anything needed,
then let KOTA begin automated improvement there. The owner prefers one common
mechanism rather than separate implementations for daemon, terminal, web, and
native clients.

## Initiative

Self-service external scope onboarding.

## Acceptance Evidence

- Inspect/plan/apply fixtures for an existing Git repository, an empty
  directory, an already registered scope, an untrusted scope config, and an
  apply failure followed by successful retry.
- A transaction artifact records the accepted plan, mutations, final scope id,
  readiness, and provenance without secrets.
- A dependency/structural search artifact proves all onboarding entrypoints
  call the same service.
