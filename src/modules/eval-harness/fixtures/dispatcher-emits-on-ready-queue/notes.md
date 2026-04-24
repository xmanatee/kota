# dispatcher-emits-on-ready-queue

## Source

No source run id. This is a smoke fixture that exists to prove the
fixture → workflow → run-emits-event / run-omits-event predicate
plumbing works end-to-end for emit-only autonomy workflows. The
initial state seeds exactly one ready task so the dispatcher's queue
snapshot produces pullableCount=1, actionableCount=1, thin=true,
empty=false, inbox=0 — a deterministic shape that pins the event set
the dispatcher must emit.

## Why no real-run source

Every one of the 987 dispatcher runs under `.kota/runs/` on this
branch is status=success. There is no real dispatcher failure to
encode, so a real-failure fixture for dispatcher cannot be
constructed honestly today. This smoke fixture covers the harness
plumbing, which was previously the load-bearing blocker: no
predicate kind existed to observe a bus-event emission, so
dispatcher was listed under `fixtures/uncovered/notes.md` with the
exact shape of the gap. With `run-emits-event` and
`run-omits-event` now in the predicate union, the gap is the lack
of a real failure, not the lack of harness capability.

If a dispatcher regression ever produces a bad event set (e.g.
`autonomy.queue.thin` when counts are actually zero, or a missing
`autonomy.queue.available` with non-zero pullable work), replace
this smoke fixture with a real-failure fixture that cites the bad
run id rather than keep both.
