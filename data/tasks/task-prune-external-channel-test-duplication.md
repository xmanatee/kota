---
status: open
priority: p1
depends_on: [task-generate-daemon-client-transport-bindings, task-centralize-approval-lifecycle-state, task-centralize-owner-decision-lifecycle-state]
---

# Prune external channel test duplication

## Scope / Starting Points

Inventory `src/core/channels` and Telegram, Slack, email, webhook, push, and related modules for identity/trust mapping, callbacks, parsing, confirmation, rendering, delivery, retry, fixtures, and copied domain lifecycles.

## Required Changes

- Retain checks for untrusted input, identity binding, authorization mapping, callback integrity, confirmation, message parsing/rendering, delivery effects, retries, and provider limits.
- Delete approval, owner-decision, task, search, and data-result lifecycle matrices already owned below.
- Replace bespoke host fixtures with narrow production adapter ports; keep real provider-shaped boundaries only where they catch a distinct failure.

## Must Not Complete While

Any channel/scenario is unclassified, any channel decides domain lifecycle state, or shared behavior remains copied per provider.

## Done When

The inventory has zero unresolved rows and each retained scenario names a channel-specific trust, parsing, rendering, delivery, retry, or limit failure.

## Acceptance Evidence

Provide the channel/scenario/disposition matrix and before/after executable-test and authored-support LOC.

## Initiative

Child of `task-prune-operator-and-channel-test-duplication`.
