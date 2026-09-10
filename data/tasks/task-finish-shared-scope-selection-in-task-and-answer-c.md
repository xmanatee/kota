---
status: open
priority: p1
---
# Finish shared scope selection in task and answer clients

## Problem

The earlier three-module consolidation in
task-centralize-module-scope-selection-policy (339064b8b) is useful. Two consumers
were missed: repo-tasks/scope.ts and answer/scope-context.ts retain independent
selection policies instead of core/daemon/scope-selection.ts.

repo-tasks/scope.ts storeFor(scope, defaultScopeId) reuses its originally built
provider whenever a scope equals the current live default. index.ts constructed
that provider for the original workspace. After the default changes, semantic
search/reindex can therefore target the wrong store. AnswerHistory has the same
identity problem; answer/scope-context.ts also falls back to the ambient registry
when an explicitly supplied host context returns null.

## Desired Outcome

Migrate these real consumers to the existing shared selection owner. Pin each
initial provider to its actual construction scope, while resolving live explicit,
active/default and later-added scopes correctly. Respect a supplied host boundary;
absence there must not fall through to another host's registry. Keep distinct
store factories, caching and native-writer authority with their owners.

## How We Will Know

Search all module factories, local clients, routes and scope snapshot declarations
for remaining copied policy. Exercise real task search/reindex and answer-history
stores across a default change, explicit unknown scope and isolated host absence.
Shared selection rules stay tested once; retain consumer-specific data isolation
proofs. Remove replaced selectors and duplicate policy tests; no universal module
base class, service locator, registry or compatibility layer.