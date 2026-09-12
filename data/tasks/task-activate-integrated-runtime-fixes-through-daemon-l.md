---
status: blocked
priority: p1
---
# Activate integrated runtime fixes through daemon lifecycle

## Current Contract

Reopened under the September 12 owner waiver. Finish any lifecycle defects and
validate real process handoff, isolated restart, ownership and refill through an
available supported context; controlled-port assertions alone are insufficient.
The already observed production activations remain partial evidence. A further
launching-daemon rollout is non-gating operational follow-up, owned by the host
lifecycle, not permission for a builder to restart its parent or bypass isolation.

This contract supersedes historical blocking and operational-capture requirements.

## Blocked on

kind: operator-capture
path: .kota/runs
description: Supported isolated execution with a permitted daemon control listener, or equivalent attributable restart evidence demonstrating fresh API/process identity, preserved ownership and refill. Authorized automated collection is sufficient; no manual capture, specific directory or launching-daemon rollout is required.

The required real isolated restart needs a supported execution context permitted
to open the daemon's loopback control listener, or an attributable execution
export establishing the same process/API handoff, ownership preservation and
refill. This builder's September 12 sandbox rejected both a minimal loopback
listener and unmocked `Daemon.start()` with `EPERM: listen ... 127.0.0.1`.
That establishes a restriction of this execution context, not absence of host
capability or credentials. No alternate callable isolated executor or qualifying
isolated-restart export was available in this step. The launching daemon's next
rollout remains non-gating; restarting it or bypassing isolation is not the remedy.

## September 12 scoped verification

Run `2026-09-12T06-40-55-857Z-builder-zljmps` reviewed the existing daemon
publication/restart path, config reload, workflow restart bridge, runtime revision
policy and supervisor ownership. No production changes were needed on the
evidence examined. All 34 tests passed with:

`pnpm test:owner src/core/daemon/daemon-runtime-activation.test.ts src/modules/daemon-ops/daemon-supervisor.test.ts src/core/daemon/daemon-instance-lock.test.ts`

These distinguish relevant publication from no-op/replayed changes, coalescing,
durable queued identity and pause/backoff preservation, stale/failed activation,
duplicate-owner rejection, real child reservation handoff and cancellation.
Their controlled-listener scenarios still do not prove the required real API
restart journey.

The additional unmocked startup probe used a fresh temporary scope, isolated
authority/token paths, production daemon initialization and no workflows. It
reached the actual listener and failed with the sandbox error above. Shutdown
left no instance lock or control identity; the temporary scope was removed.
`isolated-startup-probe.json` in this run's agent directory records the timestamp,
process identity, boundary, error and cleanup observations. No launching-daemon
control or canonical runtime-state access was used.

The supplied `issue-evidence.json` export, captured at
`2026-09-12T06:51:37.420Z`, confirms successful publications and empty resource
lists for historical runs `un8vlq` (`00588eaa61cbae0f3acc9a37f10b1ae5414ba1c5`)
and `91e2py` (`3a253459480a29bc7dd6ed824464dded7ebbea72`). It contains no
complete isolated-restart observation. Historical production activation remains
partial evidence. Resume with the supported isolated execution capability or
equivalent attributable evidence; the unmet acceptance is fresh API/process
identity and preserved ownership/refill through that real restart. Only this
task's disposition changed; existing runtime implementation and other writers'
contracts remain intact.


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
Demonstrate activation with queue/ownership preserved, fresh API/process identity
and capacity refill through the supported isolated lifecycle. Keep implementation
and testing with lifecycle owners, not builder-specific exceptions.

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
proof did not establish a production activation.

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
a complete live activation was not observed by that probe.

Supervisor cancellation proof sends SIGTERM and SIGINT through the supervisor
to real replacement children during preflight. Intentional stop waits for child
exit, releases the reservation, retains an unfailed activation target, and admits
the unchanged runtime on the next start. A child returning the restart exit code
after a stop request cannot override cancellation and spawn another replacement.
These focused process checks cover the retained shutdown repair; they do not
establish an additional production activation.

## Historical Live Observations

Live monitoring on September 10 observed a successful first activation:
integration `5f3b76bd5` requested restart at 15:50:29Z; PID 47676 drained after
the next integration, exited at 15:52:09Z, and launchd-owned replacement PID 56008
loaded `a1e554510`. It restored 29 queued identities and admitted builder
`2026-09-10T02-03-16-222Z-builder-91e2py`. The three recovered writers subsequently
showed durable successful publications, zero resource leases and removed
worktrees. `/health` remained healthy. These are live partial acceptance facts,
not a substitute for the complete scenario below.

The third publication `9364f31be` then requested another drain. `/status` exposed
activation `draining`, while `/workflow/status` described a generic runtime pause.
Do not mistake this for an owner pause or override the drain. Finish checking
coalescing and refill after the active run terminates. Its expensive evidence
preflight is owned by `task-bound-recovery-evidence-collection-to-relevant-work`.
Keep restart disposition intelligible through the existing status contract,
without adding another pause owner or activation mechanism.

The next drain completed after gardener `91e2py` integrated `3a2534594` at
17:44:08Z. Replacement PID 6889 loaded that exact revision, reported active,
resumed dispatch and admitted two original retained builders at 17:44:21Z.
Gardener cleanup and durable completion publication were verified. This supplies
live coalescing and refill evidence; it does not prove an isolated restart probe.

Integration `1743ee4d3` requested another drain at 18:20:12Z while `un8vlq`
was in preflight. Queued dispatcher, runtime health and issue-consumer work also
waits behind global admission closure. Report this as an activation gate, not
absence of work or provider backoff. Attribute host suspension separately from
the expensive preflight owned by the existing P0 evidence-collection task.
Evaluate this repeated-update journey when judging activation acceptance; do
not bypass the shared restart owner or interrupt healthy work to force refill.
