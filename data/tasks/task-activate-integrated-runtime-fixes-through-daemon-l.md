---
status: blocked
priority: p1
---
# Activate integrated runtime fixes through daemon lifecycle

## Problem

Runtime changes can integrate successfully while the persistent daemon continues
executing old loaded code. Extraction fix 09086d643 integrated Sept 9 23:25 UTC,
but PID 79706 still used definitions loaded 22:54 and later explorers retained
head/preload fragments. Operator safely drained and restarted through the normal
CLI today; PID 18188 loaded main 4ef8db519 at 2026-09-10T01:47:22.368Z.
Publication alone had not activated the fix.

## Desired Outcome

Connect relevant integrated runtime-code changes to the existing host-owned
requestRestart/drain/supervisor lifecycle. Expose loaded revision versus canonical
revision so activation is observable. Inspect daemon.ts, daemon-handle-config-reload.ts,
step-context requestRestart and post-integration publication before changing any
owner. Reuse one lifecycle; no agent may restart its own launching parent, no
second supervisor or parallel hot-reload engine. Data/docs-only commits should
not cause restarts; repeated relevant commits should coalesce during a drain.

Preserve operator pauses, provider backoff, queued run identities, retained work
and admitted contracts. Safe activation must not starve behind infinite refill or
interrupt healthy running work. A failed activation remains visible with its
revision, not a success claim or a restart loop. Integration completion must be
durable before shutdown. Reconcile loaded definitions through existing recovery,
never silently rewrite queued/held contracts or discard worktrees.

## How We Will Know

Use existing lifecycle scenarios for relevant integration, no-op data commit,
coalescing while active work drains, paused/backed-off startup and failed startup.
Then demonstrate a harmless runtime revision activating once with queue/ownership
preserved, fresh API/process evidence and capacity refill. Keep implementation and
testing with lifecycle owners, not builder-specific exceptions.

## Implementation and verification

The builder retained daemon-owned activation after durable workflow publication,
global admission closure during the existing drain, import/build revision
reporting, persisted activation targets, and supervisor failure reporting. Runtime
recovery continues to own queued identities, admitted contracts, and retained
writers. Source installations activate by restarting; built installations report
a failed target if restart still loads an older build and require rebuilding
before retry.

Focused owner proof uses real Git publication, SQLite, daemon startup/shutdown,
and queue recovery with controlled network listeners, port availability, and the
validator subprocess. It distinguishes documentation-only publication from runtime
changes, duplicate/older publication replay from a new target, healthy draining
from interruption, and preserved pause/backoff/queued identity from capacity
refill. Additional checks cover failed startup, stale builds, persisted status
decoding, and the supervisor parking after failed replacement startup or spawn.
Repair verification reopens persisted failure state across simulated service
relaunches: unchanged and documentation-only revisions launch no child, while
changed runtime code can activate. The parked supervisor remains resident for
launchd KeepAlive and systemd; daemon initialization independently rejects
unchanged failed revisions. Production and test typechecking and focused lint
pass alongside the owner tests. The subprocess boundary is controlled, so this
proof does not replace the live acceptance condition below.

Each new process also revalidates previously active targets against its loaded
revision and confirms readiness again. Regression proof rejects stale or unknown
build revisions with persisted failure, accepts identical, descendant, and
runtime-equivalent revisions only after readiness, and records replacement
startup failure even when the target had previously activated successfully.
The supervisor acquires and retains the daemon instance reservation before
expiring prior readiness or spawning a replacement. Children authenticate that
parent reservation and retain it across shutdown while removing their own control
identity. Rejected duplicate starts cannot mutate activation state or park on
another owner's failure.
Regression cases now cover spawn errors and pre-initialization exits from a
previously active target, retaining failure details and parking across unchanged
and documentation-only service relaunches until changed runtime code succeeds.

Ownership repair proof holds the real instance lock and rejects competing starts
with byte-identical state and lock contents for active, starting, draining, and
failed targets. A real child-process probe authenticates the inherited reservation,
publishes and removes its control identity, and repeats through a supervised
replacement before final lock cleanup. Core lock tests also reject the wrong
parent or token. This proves the process handoff without a network listener;
the complete live activation acceptance below remains blocked.

Supervisor cancellation proof sends SIGTERM and SIGINT through the supervisor
to real replacement children during preflight. Intentional stop waits for child
exit, releases the reservation, retains an unfailed activation target, and admits
the unchanged runtime on the next start. A child returning the restart exit code
after a stop request cannot override cancellation and spawn another replacement.
These focused process checks cover the retained shutdown repair; they do not
substitute for the complete live acceptance below.

## Blocked on

kind: operator-capture
path: .kota/runs
description: Runtime-owned isolated live activation evidence with fresh process/API identity, preserved queued ownership, and capacity refill; equivalent attributable exports are accepted.

Attributable live activation evidence from a runtime-owned isolated execution
that permits loopback listeners and process identity inspection. This builder's
sandbox rejects the existing daemon restart scenarios with `listen EPERM` and
the validator/process recovery boundary with `/bin/ps EPERM` / `spawn-failed`.
Those denials describe this execution environment, not host capability or missing
credentials. No callable scoped runtime probe/export was available in this step.

Resume by running the real lifecycle scenarios and collecting a harmless
integrated runtime revision activating once, with fresh API/process identity,
preserved queue/ownership, and subsequent capacity refill. Equivalent attributable
runtime-owned evidence is sufficient; no specific capture directory or manual
operator procedure is required. The launching daemon must remain under its host
lifecycle owner. Controlled-port tests and static checks do not satisfy this
remaining live acceptance condition.
