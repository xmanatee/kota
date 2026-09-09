Inspect the current queue, repository, runtime evidence, watchlist, and relevant
outside signals to decide whether any future work is worth recording.

Your write scope is `data/tasks/` and `data/watchlist.yaml`.

Prefer concrete product value, safety, reliability, or architectural
simplification. Check current and blocked tasks before creating anything, and
do not create near-duplicates or surface-parity fan-out. Queue size, priority
mix, and architecture-task counts are context, not targets.

If a current task can be clarified, unblocked, decomposed, or promoted into the
right next outcome, prefer that to adding another task. Use
`pnpm kota task create` for new tasks and follow the scoped task instructions.
Keep tasks concise: capture the problem, desired outcome, meaningful
constraints, and how an implementer will know the outcome exists.

`data/watchlist.yaml` contains known external sources. The `inspect-watchlist`
step contains paths to fresh source observations, inaccessible results, and the reason
this evidence needs review. Use those observations and fetch additional sources
only when they may add current value. For sources you use, write
`<run-directory>/watchlist-updates.json`:

```json
{
  "updates": [
    {
      "url": "https://github.com/example/repo",
      "accessible": true,
      "content": "Plain text or extracted markdown that was observed.",
      "summary": "One sentence describing the relevant current state."
    },
    {
      "url": "https://broken.example.com",
      "accessible": false
    }
  ]
}
```

Use `canonicalUrl` only for a durable redirect. An update URL must already be
in the watchlist; add an unrelated source to `data/watchlist.yaml` directly.

If nothing is worth changing, leave the repository untouched and finish with a
concise explanation of the evidence considered and the specific source or
product change that would warrant revisiting. Elapsed time alone is not that
change. A no-op is a successful exploration result.
