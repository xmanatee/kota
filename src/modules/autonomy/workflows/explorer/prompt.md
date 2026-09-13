Inspect the current queue, repository, runtime evidence, watchlist, and relevant
outside signals to decide whether any future work is worth recording.

Your write scope is `data/tasks/` and `data/watchlist.yaml`.

Prefer concrete product value, safety, reliability, or architectural
simplification. Check current and blocked tasks before creating anything, and
do not create near-duplicates or surface-parity fan-out. Queue size, priority
mix, and architecture-task counts are context, not targets.

If a current task can be clarified, unblocked, decomposed, or promoted into the
right next outcome, prefer that to adding another task. Edit task Markdown
directly and follow the scoped task instructions.
Keep tasks concise: capture the problem, desired outcome, meaningful
constraints, and how an implementer will know the outcome exists.

`data/watchlist.yaml` contains known external sources. The `inspect-watchlist`
step contains paths to fresh and retained readable source observations, inaccessible results, and the reason
this evidence needs review. Use those observations and fetch additional sources
only when they may add current value. Retained material establishes what was
read at its original observation time, not current upstream behavior. An
unavailable optional source does not block independent ideas grounded in readable
material. Edit `data/watchlist.yaml` directly when
a source observation or a useful new source is worth recording. Preserve operator
notes, added dates, comments, and untouched snapshots.

For an observed source, use its runtime fingerprint from `inspect-watchlist`
in `snapshot.fingerprint`, a factual `snapshot.summary`, and its observation time
in `snapshot.last_seen_at`. Keep a new source's snapshot absent until runtime
evidence is available. For failed current access, set `status: inaccessible` and retain
the last useful snapshot; remove that status when a fresh fetch succeeds, not merely when retained bytes are available. Use
`canonicalized_from` only for evidenced durable redirects, retaining prior URLs
on one canonical entry without duplicate resources or lost operator notes.

If nothing is worth changing, leave the repository untouched and finish with a
concise explanation of the evidence considered and the specific source or
product change that would warrant revisiting. Elapsed time alone is not that
change. A no-op is a successful exploration result.
