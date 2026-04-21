# Trim AGENTS implementation catalogs back to decisions

Some recent AGENTS additions improved local guidance, but the documentation
surface is drifting back toward implementation inventories.

Evidence:
- `src/modules/eval-harness/AGENTS.md` is long and names fixture files, entry
  points, routes, workflow names, fields, and mechanics that are directly
  discoverable from code.
- `src/modules/autonomy/AGENTS.md` includes concrete run ids/evidence even while
  saying evidence belongs in run artifacts.
- `docs/STANDARDS.md` says durable docs should hold high-level decisions and
  avoid file inventories, command catalogs, and duplicated implementation facts.

Desired direction:
- Reduce AGENTS files to durable boundaries, ownership, design decisions, and
  contribution rules that cannot be checked with one shell query.
- Keep exact fixtures, routes, event names, enum values, and run ids in code,
  tests, or run artifacts.

