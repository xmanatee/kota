# Superseded builder dead-letter dismissal

Dead letter: `dlq-76a47a9a-4a59-4ad7-bc61-833291ca543d`

## Canonical repair

Canonical `main` was at `5ae82c42c` and contained commit `7e87c2c5f`
(`Handle native merge resolver fallback`) from
`task-make-builder-merge-conflict-recovery-compatible-wi` and candidate run
`2026-07-25T12-37-16-777Z-builder-mxhqzo` before dismissal.

That candidate replaces the unsupported native-tool resolver throw with a
deterministic unresolved result. The merge gate preserves the conflicted
worktree as pending instead of dispatching a harness whose native tool control
cannot enforce KOTA's bounded file guard.

## Before

`dead-letter-before-dismissal.json` was exported from the canonical store at
`/Users/xmanatee/Desktop/mono/apps/kota/.kota/dead-letter-queue/items.json`.
It records status `open`, the original native-tool resolver failure, failed run
`2026-07-25T10-03-33-551Z-builder-ugava5`, and zero redrive attempts.

## Disposition

The item was dismissed through KOTA's authenticated daemon control route. It
was not redriven because the old run would reuse its stale conflicted worktree
and would not exercise the canonical candidate.

Stored rationale:

> Superseded by task-make-builder-merge-conflict-recovery-compatible-wi,
> candidate run 2026-07-25T12-37-16-777Z-builder-mxhqzo, canonical commit
> 7e87c2c5f. The candidate replaces the native-tool resolver throw with a
> deterministic pending-merge fallback; redriving failed run
> 2026-07-25T10-03-33-551Z-builder-ugava5 would reuse its stale conflicted
> worktree and would not exercise the canonical fix.

## After

`dead-letter-after-dismissal.json` records status `dismissed`, dismissal time
`2026-07-25T13:27:43.629Z`, and the stored rationale above.

`open-builder-dead-letters.json` records the subsequent
`status=open, workflow=builder` query. Its filtered `items` list is empty, so
the dismissed id no longer appears in the open builder dead-letter list. The
returned counts are store-wide totals, not filtered builder counts.
