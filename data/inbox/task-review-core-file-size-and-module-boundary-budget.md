# Review core file size and module boundary budget

Source / intent: Broad daemon review on 2026-04-28 found core is well guarded
but still has large files and module-owned protocol details in central places.

Known examples:

- `src/core/server/kota-client.ts`
- `src/core/server/daemon-client.ts`
- `src/core/daemon/daemon.ts`
- `src/core/daemon/daemon-control.ts`
- `src/core/workflow/run-executor.ts`

Desired outcome: Produce a focused boundary/file-size pass that either opens
specific split tasks or proves the file should stay as-is. Do not create
mechanical split work unless it moves ownership toward the architecture docs.
