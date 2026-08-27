---
status: done
---

# Replace owner notes with task intake

## Problem

`NOTES.md` acted as a second intake and tracking system alongside `tasks/`,
which duplicated status, history, and prioritization.

## Desired Outcome

New owner requests should enter through `tasks/inbox/`, then move through the
normal task states instead of living in a separate notes file.

## Constraints

- Keep permanent behavioral rules in docs, not in task files.
- Make the intake process easy enough for rough capture.
- Do not create another side channel for work tracking.

## Done When

- Owner requests can be added directly to `tasks/inbox/`.
- The task system explains triage and pull flow clearly.
- `NOTES.md` is no longer part of the active process.
