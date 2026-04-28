# Measure autonomy task balance and quality

Source / intent: The 2026-04-28 review produced useful manual stats, but there
is no reusable operator report that answers whether autonomy is balanced.

Questions to automate:

- How much work is p0/p1/p2/p3 over time?
- How much work is architecture/runtime/modules/client/operator-ux/research?
- How often does explorer generate strategic work vs narrow fan-out?
- How often does builder land tests, docs, client parity, or core changes?
- How many tasks are blocked by owner decision, operator capture, or missing
  capability?
- How much cost per completed task, by workflow and area?

Desired outcome: A `kota` report or dashboard panel gives these signals from
task files, git history, and `.kota/runs/`, so reviews like this are
repeatable instead of ad hoc shell analysis.
