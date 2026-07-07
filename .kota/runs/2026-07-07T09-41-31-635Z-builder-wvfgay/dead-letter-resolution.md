# Dead-Letter Resolution

Target: `dlq-418d397f-9567-497d-b2b9-6591cfc0bcca`

The item should be dismissed rather than redriven. The failed builder run
`2026-07-07T06-33-49-255Z-builder-s5hnlo` failed because the Codex websocket
reset before completion. Its claim on
`task-run-shadow-semantic-reviewers-for-non-builder-auto` is no longer active:
the claim was archived at `2026-07-07T07:08:22.727Z`.

The same task was subsequently claimed by
`2026-07-07T06-33-49-256Z-builder-79nvwh`, which reached pending-merge state.
That later run is blocked by merge-gate validation command shape, not by the
stale claim from the original failed run. Redriving the original trigger would
duplicate recovered work and re-enter stale queue context.

Canonical mutation status: blocked by sandbox. Daemon HTTP was unreachable from
this builder sandbox, and direct canonical CLI dismissal failed while writing
`/Users/xmanatee/Desktop/mono/apps/kota/.kota/dead-letter-queue/items.json.tmp`
with `EPERM`.

Required operator action:

```
TMPDIR=/private/tmp node --conditions=source --import tsx src/cli.ts workflow dlq dismiss dlq-418d397f-9567-497d-b2b9-6591cfc0bcca --reason "Dismissed as superseded by builder run 2026-07-07T06-33-49-256Z-builder-79nvwh: the original run 2026-07-07T06-33-49-255Z-builder-s5hnlo failed from a Codex websocket reset, its task claim was archived at 2026-07-07T07:08:22.727Z, and the later run claimed task-run-shadow-semantic-reviewers-for-non-builder-auto and reached pending-merge evidence. Redriving the stale trigger would duplicate recovered work."
```

Then capture the after-state JSON at
`.kota/runs/2026-07-07T09-41-31-635Z-builder-wvfgay/operator-dlq-after-dismissal.json`.
