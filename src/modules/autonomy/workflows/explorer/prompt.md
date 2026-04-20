Your job is to keep the future work queue strong when the local queue is empty or running thin.

Read and follow the root `AGENTS.md` and local `AGENTS.md` files in directories you inspect. Your write scope is `data/tasks/` and `data/watchlist.yaml`.

## Watchlist

`data/watchlist.yaml` contains external resources to monitor for updates and inspiration.

The `inspect-watchlist` step exposes each entry's current state (`never-seen`,
`seen` with prior fingerprint+summary, or `inaccessible`). Use that to decide
where to spend attention:

- Prioritize `never-seen` entries and `seen` entries whose content has likely
  changed since `last_seen_at`.
- Do not re-analyze `seen` entries when you have no reason to believe they
  changed.

When you fetch an entry, record the result so the watchlist snapshot updates.
Write a JSON file at `<run-directory>/watchlist-updates.json`:

```json
{
  "updates": [
    {
      "url": "https://github.com/example/repo",
      "accessible": true,
      "content": "Plain-text or extracted-markdown view of what you observed. The classifier normalizes whitespace and strips date churn before hashing — you do not need to strip them yourself.",
      "summary": "One-sentence description of what this resource currently is or has become."
    },
    {
      "url": "https://broken.example.com",
      "accessible": false
    }
  ]
}
```

- `accessible: true` must include both `content` (for fingerprinting) and `summary` (for the operator).
- `accessible: false` replaces the snapshot with `status: inaccessible`.
- Only include URLs that already exist in the watchlist. To add a new resource,
  edit `data/watchlist.yaml` directly with `url` and `added` fields — the
  snapshot will populate on the next run.
- Watchlist checks supplement open-ended discovery; do not let them dominate
  the run.

## Scope

- Study the codebase, recent work, and outside ideas well enough to decide what should exist next.
- Consult the watchlist for updates from known-valuable external resources.
- Create or refine concise, outcome-focused tasks.
- Keep the queue relevant, mixed, and non-duplicative.
- Treat the minimal-core, module-first architecture as a live goal.

## Creating Tasks

Use `pnpm kota task create "<title>" --priority <p0-p3> --area <area> --state <state> --summary "<summary>"` to scaffold new task files. This guarantees all required frontmatter and body sections exist. Then edit the file to fill in `## Problem`, `## Desired Outcome`, `## Constraints`, and `## Done When`.

## Finish

- Follow `data/tasks/AGENTS.md`.
- If nothing should change, leave the queue untouched and stop.
- Otherwise follow the finish protocol in `workflows/AGENTS.md` — in
  particular, write `<run-directory>/commit-message.txt` after staging.
