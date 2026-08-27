---
id: task-prune-operator-and-channel-test-duplication
title: Prune operator and channel test duplication
status: backlog
priority: p1
area: operator-experience
summary: Keep CLI, web, mobile, Apple, Telegram, Slack, and other channel tests focused on interaction semantics they add instead of replaying domain lifecycles.
task_class: Product
depends_on: [task-generate-daemon-client-transport-bindings, task-unify-client-resource-state-and-search-shells, task-centralize-approval-and-owner-decision-state]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

Operator surfaces frequently retest every domain result arm, task lifecycle, approval transition, search outcome, and daemon error already owned below. Channel fixtures also rebuild large hosts to assert parsing or rendering, making test cost scale with every new surface.

## Desired Outcome

Operator adapters own option and message parsing, identity and trust mapping, confirmations, exit status, accessibility, platform navigation, rendering, and external delivery effects. Domain decisions and lifecycle transitions remain below them, and a few vertical journeys cover only high-value composition boundaries.

## Constraints

- Preserve owner-visible wording and behavior where it is itself a contract; do not freeze incidental formatting or entire output snapshots.
- Keep security-sensitive identity, authorization, confirmation, and external-effect checks at the adapter boundary.
- Use shared production UI shells and generated transport rather than shared test fixtures that preserve duplicated product code.
- Delete route, CLI, screen, and channel copies of domain tests in the same change that establishes ownership.

## How We Will Know

- Each operator surface suite names only parsing, trust, confirmation, rendering, accessibility, navigation, or delivery failures unique to that surface.
- Domain result matrices are not repeated per channel merely because wording differs.
- A small set of real operator journeys covers composition without duplicating every local, source, built, and daemon path.
- Operator and channel test LOC and setup complexity fall materially while visible behavior remains credible.
