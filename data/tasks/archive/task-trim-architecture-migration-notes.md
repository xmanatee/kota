---
status: done
---

# Trim stale migration wording from architecture docs

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
