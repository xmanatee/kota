---
id: task-mobile-client-design
title: Produce design specification for the KOTA mobile client
status: done
priority: p2
area: client
summary: Write the design spec, navigation structure, wireframes (as markdown), and daemon API surface requirements for the mobile client, unblocking task-build-mobile-client.
created_at: 2026-04-08T22:45:00Z
updated_at: 2026-04-09T00:00:00Z
---

## Problem

`task-build-mobile-client` is blocked because the implementation scope is too large to tackle without a prior design pass. There is no agreed navigation structure, no defined interaction model for approvals, no decision on native vs. cross-platform, and no specification of which daemon API endpoints the client actually needs. Without these, a builder run will either stall or produce an incomplete, misdirected implementation.

## Desired Outcome

A `docs/MOBILE-CLIENT-DESIGN.md` file that covers:

- **Technology decision**: Recommendation (SwiftUI, React Native, or other) with rationale.
- **Navigation structure**: Top-level screens and their hierarchy (status overview, run list, run detail, approvals, tasks, settings).
- **Wireframes**: ASCII or markdown-table layout for the 3-5 most important screens.
- **Daemon API surface**: Exact endpoints, event subscriptions, and polling strategy the client needs.
- **Auth and discovery flow**: How the client locates the daemon, presents the token, and handles offline state.
- **Key interaction**: How an operator reviews and resolves a pending approval from the phone.

## Constraints

- Output is a design document, not code.
- All live state must come from the daemon control API (`docs/DAEMON-API.md`). The spec must not assume any direct file access.
- Keep the spec concise and builder-actionable — avoid over-specifying visual style.
- Update `tasks/blocked/task-build-mobile-client.md` to reference the spec and remove the blocked reason once the design is complete.

## Done When

- `docs/MOBILE-CLIENT-DESIGN.md` exists and covers all sections above.
- `task-build-mobile-client` `blocked_reason` is cleared and the task is moved to `backlog/` or `ready/`.
