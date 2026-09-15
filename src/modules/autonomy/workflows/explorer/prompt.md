Replenish useful independent work when the queue cannot sustain delivery. Inspect
the repository, operator journeys, runtime evidence and relevant outside ideas;
the watchlist is a starting point, not the boundary of discovery.

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

`data/watchlist.yaml` contains recurring discovery sources. Keep entries whose
future developments could change a local decision, with that reason in `notes`.
Prefer an evolving project, release, or research-series surface over an individual
paper, article, or overlapping reference page. Keep settled references discoverable
in their existing task or decision records; finding or citing an article does not
require adding a monitor or a task. Use weekly refresh for slower sources; the
default is daily. An inaccessible source remains eligible for later recovery.

The `inspect-watchlist` step identifies fresh and retained observations and
whether those particular inputs need another review. Settled or inaccessible
watchlist inputs do not mean discovery is exhausted. Consult previous explorer
outcomes and related archived tasks; pursue a different grounded question instead
of repeating a rejected proposal. Inspect an unmet product journey, an unexplored
capability or a maintenance problem, and research relevant sources beyond the
watchlist. Turn verified opportunities into coherent, implementable tasks; do
not require an upstream project to change before improving this one.
Retained material establishes what was
read at its original observation time, not current upstream behavior. An
unavailable optional source does not block independent ideas grounded in readable
material. Edit `data/watchlist.yaml` directly when
an observation or a justified recurring source is worth recording. Preserve operator
notes, added dates, comments, and untouched snapshots.

For an observed source, use its runtime fingerprint from `inspect-watchlist`
in `snapshot.fingerprint`, a factual `snapshot.summary`, and its observation time
in `snapshot.last_seen_at`. Keep a new source's snapshot absent until runtime
evidence is available. For failed current access, set `status: inaccessible` and retain
the last useful snapshot; remove that status when a fresh fetch succeeds, not merely when retained bytes are available. Use
`canonicalized_from` only for evidenced durable redirects, retaining prior URLs
on one canonical entry without duplicate resources or lost operator notes.

If a pass finds no justified task, leave the repository untouched. Record the
questions investigated, concrete reasons for rejecting those leads and a
different promising direction for the next pass in the run summary. A no-op is
valid evidence about that investigation, not a conclusion that no useful work
exists. Never fabricate defects, duplicate tasks or weaken security to fill slots.
