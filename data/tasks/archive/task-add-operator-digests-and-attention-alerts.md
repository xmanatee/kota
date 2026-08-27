---
status: done
---

# Add operator digests and attention alerts

## Problem

KOTA already sends failure and approval alerts, but there is no mechanism for surfacing patterns that deserve operator attention without being per-event noise:
- repeated workflow failures across cycles
- budget pressure (high spend rate, approaching limits)
- long-running stalled work (blocked tasks, high doing-count with no progress)
- significant completed work that deserves human review

## Desired Outcome

- A digest or attention surface that summarizes these patterns on a useful cadence (e.g., after N runs or at a threshold).
- Complements existing per-event alerts without duplicating them.
- Avoids spam — quiet when everything is healthy.

## Constraints

- Do not replicate the existing failure alert path.
- Keep the digest concise and actionable, not a raw log dump.
- Prefer the existing notification/alert infrastructure over a new parallel surface.

## Done When

- Operator receives a digest when a meaningful attention pattern is detected.
- The digest is quiet when nothing warrants attention.
- No duplicate notifications for events already covered by existing alerts.
