---
status: open
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