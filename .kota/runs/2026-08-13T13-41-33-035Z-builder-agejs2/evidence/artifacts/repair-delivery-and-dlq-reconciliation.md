# Builder repair delivery and DLQ reconciliation

## Live verification

- Verification run: `2026-08-13T13-41-33-035Z-builder-agejs2`.
- Trigger: `autonomy.queue.available` after the restart required by
  `132438782a063cabc88a8f04445f0c574035cf85`.
- Workspace HEAD `ab8ff7323` contains that fix.
- The initial Codex builder invocation reached normal task work and the focused
  repair-loop command passed. This first phase deliberately leaves the task in
  `doing` without `success-criteria-verified.txt`, so KOTA's ordinary
  post-checks must launch a real repair iteration. The initial invocation is
  not treated as proof of repair delivery.
- KOTA launched post-check repair attempt 1 for the build step. The Codex
  repair invocation received the ordinary `commit-stageable` result and
  continued in the preserved builder evidence directory without an SDK or
  provider rejection for the unsupported `resumeSessionId` option. This is the
  requested live proof that a fresh repair call reaches the repairing agent.
- The reported `Builder evidence filesystem operation failed (ENOENT)` was the
  expected consequence of the deliberately absent required root evidence file,
  `success-criteria-verified.txt`. This repair creates that file and records
  both numbered verification results. Direct reinspection reports all six
  registered evidence files ready. The task mover retained the completed
  transition through KOTA's protected-index workflow-host bridge; the workflow
  host owns its exact-path restaging before the post-check stageability rerun.

## Resume-related dead letters

The four matching open workflow-dispatch items are identified by the failed
run lineage preserved in commit `132438782a06`:

1. builder `2026-08-13T10-23-52-462Z-builder-bojhem`
2. improver `2026-08-13T10-24-20-075Z-improver-oku661`
3. builder `2026-08-13T10-59-08-563Z-builder-tq9ibo`
4. builder `2026-08-13T11-49-21-496Z-builder-1clmsy`

The progress-review record additionally preserves these canonical ids:

- `dlq-b8c26da0-96dd-41ae-99e5-df191d245afe`
- `dlq-f084687d-a51d-4ebd-aba7-574d9ac57ae6`

Disposition: retain all four matching items pending canonical-store access.
The builder worktree's isolated DLQ projection reports zero items and is not
the scope store. Selecting the root scope through `KOTA_PROJECT_DIR` fails
closed because this native agent is prohibited from reading the protected
`.kota/daemon-control.json`; direct root-store access is likewise outside the
worktree write boundary. The missing two canonical DLQ ids therefore cannot be
honestly inferred or mutated from this sandbox. The failed source run ids above
remain the durable selectors for operator-side redrive or dismissal.

## Separately classified provider failure

Improver run `2026-08-13T13-18-45-672Z-improver-36d1kf` remains classified as
the unrelated transient HTTP 503. It is not evidence of the
`resumeSessionId` defect and is not included in the four retained
resume-related dispositions.
