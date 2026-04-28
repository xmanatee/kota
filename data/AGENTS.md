# Data

This directory holds mutable project data that is not source code.

- Keep rough captures, normalized work, and external-resource monitoring as
  separate concerns. Their local files own the exact storage shape.
- Keep quick captures lightweight.
- Keep normalized work specs in the task queue.
- Keep watchlist entries minimal.
- Watchlist coverage should span peer agent runtimes, vendor research surfaces,
  and representative research artifacts relevant to autonomy, memory,
  orchestration, and evaluation. Prefer project repos, engineering blogs, and
  paper-series pages that update on their own cadence.
- Do not add aggregator indexes, "awesome-*" lists, or arXiv category pages as
  watchlist entries — they inflate coverage without adding durable signal.
- Record unreachable entries honestly with `status: inaccessible` rather than
  silently dropping them.
