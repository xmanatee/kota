# Data

This directory holds mutable project data that is not source code.

- `inbox/` is for fast captures, owner notes, rough ideas, and raw resource dumps.
- `tasks/` is the normalized work queue used by autonomous workflows.
- `watchlist.yaml` is the curated list of external resources the explorer monitors.
- Keep quick captures lightweight; do not over-structure `inbox/`.
- Keep normalized work specs in `tasks/`.
- Keep watchlist entries minimal: url, added date, optional notes and status.
- Watchlist coverage should span peer agent runtimes, vendor research surfaces,
  and representative research artifacts relevant to autonomy, memory,
  orchestration, and evaluation. Prefer project repos, engineering blogs, and
  paper-series pages that update on their own cadence.
- Do not add aggregator indexes, "awesome-*" lists, or arXiv category pages as
  watchlist entries — they inflate coverage without adding durable signal.
- Record unreachable entries honestly with `status: inaccessible` rather than
  silently dropping them.
