# Explorer Workflow

This directory contains the explorer workflow definition and prompt.

- This workflow owns external product discovery and roadmap expansion when the local
  queue is otherwise empty or down to a thin tail.
- Study the codebase and relevant outside ideas, but write only under `data/`.
- Keep this workflow focused on high-leverage external discovery, meaningful
  future work selection, and strategic range.
- Keep tasks outcome-focused and concise. This workflow owns the queue contract,
  not the implementation plan.
- Queue counts are lower bounds, not the goal. A healthy queue should not
  collapse into one repeated kind of local work.
- Treat the inspect step's queue counts and availability fields as context for
  the exploration decision; task validation and writer integration own the
  hard gates.
- Record exploration completion in the run artifact. The canonical cooldown is
  advanced by the original run's success finalizer through runtime
  compare-and-set, after any repository changes integrate.
- Keep watchlist summaries factual: record the relevant current state observed
  from a source, not an adopt/reject/defer policy verdict. Durable external
  pattern verdicts live in the typed
  `src/modules/autonomy/external-pattern-decisions.ts` catalog, which remains
  outside explorer's write scope and is curated separately.

Source rechecks are deterministic reads through the normal web tool boundary.
A time-due recheck does not itself authorize another AI review: the last actual
review consumes a fingerprint of observed source content and task intent.
Failed fetches, including unavailable readable content, preserve the last useful
content identity. Page metadata and layout markup are access evidence, not
upstream product changes. Observations and reviewed fingerprints publish
through the same finalizer, including no-action.
Source content and failures stay in retained run evidence after sandbox cleanup;
the agent receives working copies inside its authorized run directory.

Author watchlist changes directly in YAML, preserving operator values, comments,
and untouched snapshots. Repair and integration publication validate the complete
watchlist and task files without rewriting them. YAML uses the parser's bounded
alias handling; invalid syntax, domain values, and conflicting source identities
fail at those boundaries. Runtime source evidence remains
the authority for content fingerprints and review cooldowns.
