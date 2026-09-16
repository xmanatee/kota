---
status: open
priority: p1
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
