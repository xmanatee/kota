---
id: task-enforce-single-mechanism-architecture-boundaries
title: Enforce single-mechanism architecture boundaries
status: backlog
priority: p2
area: architecture
task_class: Platform
depends_on: [task-render-shared-ui-surfaces-in-the-web-client, task-render-shared-ui-surfaces-in-android-mobile, task-rewrite-mcp-client-orchestration-into-focused-prot, task-rewrite-module-manifests-into-focused-owned-projec, task-separate-task-queue-structure-from-autonomy-govern, task-rewrite-dead-letter-handling-into-focused-lifecycl, task-split-client-state-into-generated-transport-and-do, task-migrate-integrations-to-the-outbound-http-transpor, task-make-remote-task-provider-mutations-durable, task-prove-self-service-external-scope-onboarding-end-t]
summary: Add deterministic architecture checks that prevent UI, contract, HTTP, browser, and registration bypasses from returning.
created_at: 2026-07-31T16:01:02.631Z
updated_at: 2026-08-24T03:03:20.000Z
---

## Problem

KOTA documentation already says there should be one mechanism per job, yet the
shared UI task was marked done while live clients still used separate semantic
inventories, and conformance intentionally preserved copied decoders. Prose
rules and manual review did not prevent bypasses from reappearing or being
accepted as complete.

## Desired Outcome

Add a small set of deterministic architecture fitness checks derived from the
completed canonical boundaries. They should fail on KOTA-owned project-as-scope
identity, persisted `doing`, a core-to-module client import, a second semantic
UI catalog, authored client wire mirror, disallowed raw fetch, Playwright
outside the browser module, direct tool/module registration bypass, alternate
slash-command catalog, or a second scope registry/onboarding path.

## Constraints

- Add checks only after the canonical migration tasks establish the valid
  boundaries; do not encode current exceptions as permanent allowlists.
- Prefer import/manifest/schema ownership checks over brittle keyword bans.
- Keep necessary platform renderers, generated artifacts, low-level transport
  adapters, fixtures, and test doubles distinguishable from authored sources.
- Allow external protocol/version compatibility only inside its owning adapter;
  do not encode KOTA-owned compatibility exceptions or broad keyword allowlists.
- Do not add a recurring AI reviewer or another architecture catalog. Use
  existing module manifests, generated-contract metadata, and focused
  deterministic checks as the source of evidence.
- Failure messages must name the canonical mechanism and exact violating path.

## Done When

- One focused architecture-check entry point verifies scope identity, task
  execution authority, core dependency direction, UI/client ownership,
  generated contract provenance, HTTP/browser ownership, and
  module/tool/command/scope-onboarding registration paths.
- Deliberate violations in each boundary fail with actionable diagnostics.
- Existing duplicate/copy/import allowlists, KOTA-owned compatibility paths,
  and stale prose conventions are removed or rewritten to point at the
  executable boundary.
- The check is included in the existing repo AI/validation surface rather than
  introduced as a separate workflow family.

## Source / Intent

The owner suggested a regular audit but asked this turn to create tasks rather
than add another agent/workflow. The audit also found that browser automation,
module/tool registration, and slash-command derivation are already canonical;
this task protects those good boundaries while mechanically locking the UI,
contract, HTTP, task-provider, and self-service scope-onboarding repairs after
they land.

## Initiative

One canonical capability mechanism per KOTA boundary.

## Acceptance Evidence

- A fitness-check report covering every boundary and its authoritative owner.
- Deliberate-break artifacts showing duplicate UI inventory, authored decoder,
  raw fetch, external Playwright import, direct tool registration, and parallel
  command or scope-onboarding path each fail for the expected reason.
- A clean repository search report with no legacy allowlist, compatibility
  path, or duplicate catalog left behind.
