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
- When explorer changes the queue, satisfy required queue-health findings from
  the inspect step before finishing instead of relying on the repair loop to
  re-run the agent.
- Other task-queue warnings stay advisory.
- Record exploration completion in the run artifact. The canonical cooldown is
  advanced only by the staged `explorer-publication` `repository: none`
  follow-up through the runtime state compare-and-set contract; do not add a
  cooldown JSON file.
- Record a watchlist source's local disposition and rationale in its summary.
  The typed external-decision store is curated separately from repeated
  evidence; explorer's data-only write scope intentionally excludes it.
