---
status: done
---
# Activate integrated runtime fixes through daemon lifecycle

## Outcome

Relevant integrated runtime changes now activate through the existing daemon
drain/restart/supervisor lifecycle. The daemon reports loaded and target revisions,
coalesces publications while draining, preserves queued identities and retained
ownership, and exposes failed activation instead of silently running stale code.
Agents do not restart their own parent; data-only edits do not request activation.

The owner waived procedural capture requirements. Acceptance uses observed live
handoffs plus focused failure-path checks, not a mandatory second demonstration
from a worker sandbox that cannot open the control listener.

## Verification

- September 10: publication `5f3b76bd5` requested activation; replacement PID
  56008 loaded `a1e554510`, restored 29 queued identities and admitted retained
  builder `2026-09-10T02-03-16-222Z-builder-91e2py`. Subsequent publication
  `3a2534594` activated in PID 6889, resumed dispatch and admitted two original
  retained builders. Published writers released resources and removed worktrees.
- September 12: retained session builder `lqcsbw` integrated `fe7744ae3`.
  Original security review `t5si5n` finalized successfully, retained inbox work
  `udfvtw` completed, and dispatcher `bcauca` admitted the next task batch.
  Independent builders `5siqh7` and `xg09i7` completed and published. API status
  subsequently confirmed PID 45221 loaded `9fb05ca587f8` under supervisor 44294.
- At 08:10 UTC, `/health` returned healthy with fresh event-loop samples.
  `/status` correctly reported activation toward `9d1f09c3a640` draining behind
  active builder `drp743`, with 24 queued identities preserved. Its completion
  remains ordinary operational monitoring, not unfinished activation code.
- Builder `zljmps` passed all 34 focused activation, supervisor and instance-lock
  tests. They cover relevant/no-op publications, coalescing, preserved pause and
  backoff, failed/stale activation, duplicate ownership, real child handoff and
  cancellation. Its additional unmocked listener probe failed with sandbox
  `EPERM`; that probe did not pass and is not counted as successful validation.

Historical implementation and probe details remain in Git history and the
referenced run artifacts. No additional activation mechanism was introduced.
