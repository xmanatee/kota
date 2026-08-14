---
id: task-keep-daemon-control-api-responsive-during-workflow
title: Keep daemon control API responsive during workflow execution
status: done
priority: p1
area: core
task_class: Platform
summary: Prevent in-process workflow code from starving the daemon control API so live status and control commands remain responsive while workflows perform CPU-heavy or synchronous work.
created_at: 2026-08-11T11:26:43.004Z
updated_at: 2026-08-13T11:39:24.834Z
---

## Problem

During the 2026-08-11 Codex daemon audit, `kota status` and `kota workflow resume` twice reported the live daemon as unreachable while PID 76251 remained alive, its Codex child and run artifacts were fresh, and workflow dispatch subsequently advanced. The API recovered without a restart. This is not the historical offline-labeling issue: the live control plane temporarily stopped servicing requests.

Workflow code steps currently call `await step.run(context)` in the daemon process. Any synchronous work before the returned promise yields blocks the same Node event loop that owns the HTTP control server. CPU-heavy parsing, repository inspection, or synchronous child-process/post-processing work can therefore make a healthy daemon appear offline and make pause, resume, status, and recovery controls unavailable exactly while operators need them.

The same audit isolated a concrete non-workflow starvation path in foreground
mode. `src/modules/daemon-ops/index.ts` includes
`getRepoTaskQueueSnapshot(projectDir)` in the dashboard snapshot supplier;
`dashboard.ts` invokes that supplier every second and synchronously after every
stderr write. The snapshot performs synchronous repository and task inspection
over roughly 1,600 task records. Process sampling caught the daemon main thread
inside timer callbacks and synchronous child-process execution while the
control API was unresponsive. Stopping the daemon also stalled until the active
agent child was terminated. This dashboard path is part of the same ownership
defect and must be fixed by this task, not left as a separate polling workaround.

## Desired Outcome

The daemon control plane remains responsive throughout workflow execution. Establish one explicit execution boundary for potentially blocking workflow code, identify and migrate blocking call sites to it, and keep runtime ownership in the daemon without duplicating live state in clients. A live daemon must not be classified as offline merely because a workflow is busy.

## Constraints

- Fix the execution architecture rather than increasing client timeouts, adding retry ladders, or falling back to persisted files as if they were live state.
- Preserve the daemon as the source of truth for dispatch, runs, sessions, approvals, and recovery.
- Keep ordinary lightweight code steps simple; do not require every workflow to implement its own worker, heartbeat, or control-server workaround.
- Preserve abort, progress, error, and run-artifact semantics across the execution boundary.
- Do not interrupt or discard active workflow work when control-plane latency is detected.

## Done When

- A behavioral integration fixture runs a deliberately blocking workflow operation while repeatedly calling `/health`, `/status`, pause, and resume; control requests complete within a documented latency bound and return live state.
- Production code steps that can block the event loop use the single daemon-owned non-blocking execution mechanism or asynchronous APIs.
- Foreground dashboard rendering does not synchronously rebuild the repository
  task projection on every timer tick or stderr write. Rendering consumes a
  cached/event-driven projection owned by the daemon, and log bursts coalesce
  rather than recursively forcing expensive snapshots.
- CLI status no longer produces a false daemon-offline result during the fixture, and pause/resume remains effective.
- Workflow completion, failure, abort, recovery metadata, and progress evidence remain correct through the new boundary.
- Event-loop or control-request latency is observable through existing runtime evidence without introducing a second lifecycle state store.

## Source / Intent

Created from the live Codex daemon audit on 2026-08-11. Evidence included a continuously alive daemon PID, fresh workflow metadata and child processes, and transient `daemon unreachable` CLI failures that cleared without restart. Source paths establishing the shared-process boundary include `src/core/workflow/steps/step-executor.ts`, `src/core/workflow/runtime-dispatch.ts`, and `src/core/daemon/daemon-control-route-invoker.ts`.

## Initiative

Trustworthy autonomous runtime and operator control plane.

## Acceptance Evidence

- Focused integration output from the blocking-operation/control-API concurrency fixture.
- A run artifact showing a long workflow operation, successful concurrent status and pause/resume requests, and correct terminal workflow metadata.
- Before/after control-request latency evidence tied to the same fixture rather than configuration snapshots.
- A foreground-dashboard fixture with a large task queue and a burst of stderr
  activity showing bounded snapshot work and responsive status/stop controls.
