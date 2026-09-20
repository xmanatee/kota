---
status: done
---

# Keep lifecycle maintenance from blocking the daemon control plane

## Observed problem

After revision `0ceada13d`, `/health` recorded a maximum timer delay of 10.735s
on September 15 at 23:55 UTC, 19.057s on September 16 at 02:34, and 60.473s
by 05:30. Dispatch was quota-held, with no active agents, retained sandboxes,
or resource leases. Four Telegram poll timeouts recovered during the last
interval. Their relationship to the timer delays is not established.

Healthy-phase API requests took 1-136ms, but September 16 checks at 17:29-17:30
took 3.726s and 5.507s with fresh timer delays of 15.488s and 14.081s. There was
no host sleep since September 12. A 70-second native sample starting 17:31 caught
704 of 3,324 main-thread samples under a timer callback, including recursive
synchronous directory enumeration, stat and file reads. JavaScript frames were
unsymbolicated; do not attribute every historical delay to that sample.

The owning maintenance path is concrete: `src/core/daemon/daemon-startup.ts`
invokes `collector.sweep()` from the session sweep timer every 60 seconds by
default. Despite its async signature, `lifecycle-collector.ts` calls synchronous
collectors. `collectRunArtifacts()` measures every run directory recursively
before applying target-run and retention decisions. A single authenticated,
read-only `GET /lifecycle/status?scopeId=8nrg1m` reproduced a 14.595-second sweep
over 2,279 candidates. No destructive sweep was requested by the monitor.

## Investigation and outcome

- Make periodic, terminal-run and explicit lifecycle inspection/collection
  responsive through the existing lifecycle owner. Measure stages to distinguish
  required retention work from unnecessary whole-history sizing/scanning. Targeted
  collection must not recursively size unrelated retained artifacts. Merely
  lengthening the timer or adding `async` without yielding is not a correction.
- Use existing asynchronous/blocking-operation mechanisms where appropriate.
  Keep inspection and deletion consistent, prevent overlapping destructive
  sweeps, and revalidate live ownership before acting on previously read evidence.
  Preserve active/pending runs, dirty work, filesystem authority checks, retention,
  quota holds and shared concurrency. Do not drop history, add another collector,
  scheduler/store, or bypass the reserve. Remove replaced paths and duplicate proof.
- Verify concurrent control requests remain responsive during a representative
  maintenance pass, with equivalent retention decisions and safe targeted cleanup.
  Account quota polling is already asynchronous; journal size (about 409MB) and
  other synchronous owners are secondary leads, not excuses for unrelated rewrites.
- Check responsiveness during quota hold, evidence admission and subsequent
  normal dispatch. Use bounded representative validation, recording limitations
  honestly. The operational monitor owns later canonical deployment observation;
  that observation is not a prerequisite the isolated builder must manufacture.

The completed `archive/task-process-incident-bursts-without-starving-delivery.md`
already delivered pending-batch coalescing and capacity-independent admission.
Its completion explicitly did not establish live HTTP latency. Reuse that work;
do not reopen the whole scheduling design or duplicate its tests. Investigate
this remaining measured concern and remove any replaced path with its fix.

## Evidence locations

Use `/health`, `.kota/events/journal.jsonl`, `.kota/kota.sqlite` read-only, and
the daemon log `.kota/daemon-managed-1787730296.err` around the times above.
The captured maintenance sample is
`/tmp/kota-daemon-health-20260916-1731.sample.txt` if still available. An earlier
healthy-phase sample at `...-0531.sample.txt` missed the work. Use bounded stage
measurements to validate the correction; do not copy raw logs into Git.

## Completion

The shared lifecycle owner now serializes and coalesces sweeps, moves metadata
and journal preparation to blocking workers, uses asynchronous Git and sizing,
and selects retention candidates before measuring their artifacts. Targeted
sweeps avoid global maintenance. Live ownership is rechecked before cleanup;
directory detachment and journal append handoff protect concurrent work, and
shutdown drains the collector before closing stores.

The representative isolated daemon journey passed with 2,279 retained histories
and a 410 MiB journal: 394 control requests, maximum request 71 ms and maximum
timer delay 377 ms. Evidence admission proceeded during quota hold, agent work
completed after recovery, retention remained intact and shared concurrency held.
Loopback was denied, so this measured the production authenticated dispatcher
through an HTTP byte adapter, with the external agent SDK controlled. It does
not claim deployed TCP/provider performance or explain every historical stall.

Static checks, 50 focused owner tests, subsequent lifecycle race/drain checks,
production compilation and both compiled worker operations passed. Broader owner
checks passed 121/124; process-spawn and nested-scratch loader cases remain
unproven in this sandbox. The broader onboarding timeout reproduces on unchanged
source. Commands, measurements and limitations are retained in this builder
run's artifacts/summary.md. Canonical deployment observation remains with the
operational monitor after runtime publication.
