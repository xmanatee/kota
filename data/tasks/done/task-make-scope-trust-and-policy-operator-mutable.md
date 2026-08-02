---
id: task-make-scope-trust-and-policy-operator-mutable
title: Make scope trust and policy operator mutable
status: done
priority: p1
area: security
task_class: Safety
depends_on: [task-make-directory-scope-registration-a-live-daemon-li]
summary: Expose one machine-local authority path for changing project trust and persisted scope policy, with no repo-controlled trust or programmatic-only policy fork.
created_at: 2026-07-31T16:12:49.283Z
updated_at: 2026-08-01T23:52:02.039Z
---

## Problem

External-project trust is correctly evaluated from operator-owned global
config, but there is no typed mutation surface; the warning tells operators to
edit `~/.kota/config.json` manually. Scope policy is queryable through
`/scopes/:scopeId/policy`, yet production startup never supplies
`DaemonConfig.scopePolicies`, so useful policy fragments currently exist only
for programmatic callers and fixtures.

An onboarding flow cannot safely choose autonomy, write, confirmation, module,
or project-config authority without first making these existing mechanisms
durable and operator-mutable.

## Desired Outcome

Add one machine-local authority service for scope trust and policy mutations.
It should expose current state, validate a proposed change, apply it atomically,
and return the resolved policy plus provenance that runtime and clients already
use.

Keep each source narrow: project trust remains operator-owned machine state;
scope policy has one persisted machine-owned source consumed by
`resolveScopePolicy`; repo-local `.kota/config.json` remains project content and
cannot grant itself authority.

## Constraints

- Extend the existing `loadConfig` trust decision and scope-policy resolver;
  do not create onboarding-only allowlists or a second policy evaluator.
- A project directory can never mark itself trusted through files inside that
  directory, workflow output, or agent text.
- Trust and dangerous policy widening require an explicit operator action and
  produce an audit record. Untrusting or narrowing policy is equally
  discoverable and deterministic.
- Preserve the rule that children cannot silently widen parent dangerous
  capabilities. Return a typed conflict explaining the parent rule.
- Secrets, provider credentials, and module setup remain in their existing
  stores; this service records authority and policy, not copied credentials.
- Remove the programmatic-only production gap for `scopePolicies`; do not keep
  both startup fragments and mutable persisted fragments as competing state.

## Done When

- A daemon-hosted service can inspect and mutate trust and scope policy for a
  registered directory scope.
- `loadConfig`, workflow/tool policy application, setup visibility, and
  `/scopes/:scopeId/policy` all read the same authoritative decisions.
- Restart preserves trust/policy, with provenance explaining defaults,
  inheritance, overrides, and rejected widening.
- Concurrent or failed writes cannot leave trust and policy half-applied.
- Untrusted malicious project config cannot alter the registry, policy,
  guardrails, model/provider routing, modules, or its own trust decision.

## Source / Intent

Owner request on 2026-07-31: adding a folder should allow any required setup
before autonomous work starts. Audit evidence: `src/core/config/config.ts`
supports `trustedProjects` only through global config and
`src/core/daemon/daemon-handle.ts` resolves `config.scopePolicies`, while the
production daemon entrypoint supplies neither a live mutation path nor policy
fragments.

## Initiative

Self-service external scope onboarding.

## Acceptance Evidence

- A fixture demonstrates untrusted, trusted, narrowed, and forbidden-widening
  decisions before and after daemon restart, including provenance returned by
  the existing policy route.
- A malicious external-project fixture proves repo-local config cannot mutate
  machine authority.
- A structural artifact identifies the sole trust writer and sole persisted
  scope-policy reader/writer used by daemon, CLI, and clients.
