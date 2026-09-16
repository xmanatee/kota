---
status: open
priority: p1
---

# Diagnose and resolve recurring daemon control-plane delays

## Observed problem

After revision `0ceada13d`, `/health` recorded a maximum timer delay of 10.735s
on September 15 at 23:55 UTC, 19.057s on September 16 at 02:34, and 60.473s
by 05:30. Dispatch was quota-held, with no active agents, retained sandboxes,
or resource leases. Four Telegram poll timeouts recovered during the last
interval. Their relationship to the timer delays is not established.

Fresh API requests during the final check took 1-136ms; the latest timer delay
was 1-3ms. This is an intermittent latency signal, not a proven current stall.
macOS recorded no actual sleep/wake since September 12. A 12-second native
sample of PID 28215 at 05:30 mostly showed an idle event loop; it did not catch
the delay. Do not treat that healthy sample as proof the problem is resolved.

## Investigation and outcome

- Identify whether this is real host-active blocking, process scheduling/GC,
  suspension, or a measurement artifact before choosing a correction. The
  existing latency monitor uses `Date.now()` and does not timestamp its maximum;
  make existing evidence trustworthy and attributable where necessary, rather
  than introducing a second monitoring subsystem.
- Measure the owning callback or operation with representative retained state.
  Account quota polling already uses asynchronous child-process RPC. The event
  journal is about 409MB and some approval/storage operations are synchronous;
  these are investigation leads, not established causes. Avoid speculative
  rewrites, repeated full-history scans, and changes justified only by file size.
- Correct the measured owner with existing asynchronous/blocking-operation
  mechanisms as appropriate. Preserve filesystem authority checks, approval
  semantics, event history, quota holds, and shared concurrency. Do not mask
  failures, drop evidence, add another scheduler/store, or bypass the reserve.
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
The temporary healthy-phase sample is
`/tmp/kota-daemon-health-20260916-0531.sample.txt` if still available; new bounded
measurement is required to attribute a delay. Do not copy raw logs into Git.
