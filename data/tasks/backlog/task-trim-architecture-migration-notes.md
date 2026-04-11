---
id: task-trim-architecture-migration-notes
title: Trim stale migration wording from architecture docs
status: backlog
priority: p3
area: docs
summary: Architecture docs still contain a Migration Principles section despite standards requiring durable docs to avoid migration notes.
created_at: 2026-04-11T01:44:06Z
updated_at: 2026-04-11T01:44:06Z
---

## Problem

`docs/ARCHITECTURE.md` still has a `Migration Principles` section. Much of the
content is still useful, but the framing conflicts with the documentation
standard that durable docs should not keep migration notes or transitional
guidance.

## Desired Outcome

Keep the durable architectural principles, but remove migration framing and any
stale wording that reads like a transition checklist.

## Constraints

- Do not expand the architecture doc.
- Do not duplicate standards that already live in `docs/STANDARDS.md`.
- Keep only principles that remain useful for future design decisions.

## Done When

- `docs/ARCHITECTURE.md` no longer contains a `Migration Principles` section.
- Useful content is either folded into stable architecture sections or removed.
- Documentation remains concise and aligned with `docs/STANDARDS.md`.
