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
  advanced only by the staged `explorer-publication` `repository: none`
  follow-up through the runtime state compare-and-set contract; do not add a
  cooldown JSON file.
- Keep watchlist summaries factual: record the relevant current state observed
  from a source, not an adopt/reject/defer policy verdict. Durable external
  pattern verdicts live in the typed
  `src/modules/autonomy/external-pattern-decisions.ts` catalog, which remains
  outside explorer's write scope and is curated separately.
