# Standards

## Repository Surfaces

- `docs/` is for durable, cross-cutting reference docs.
- `data/inbox/` is for quick captures, rough ideas, and owner notes.
- `data/tasks/` is the normalized live work queue and the source of truth for outstanding work after sorting.
- Local `AGENTS.md` files explain directory purpose and boundaries.
- Git history and `.kota/runs/` are the historical record. Do not add parallel changelog, audit, archive, or lesson surfaces.
- Runtime state belongs under `.kota/`. Do not add sibling runtime directories
  such as `runs/` or `kota/` at the repo root.

## Documentation

- Keep docs concise, high-level, and current.
- Do not duplicate code, tests, prompts, or other docs unless duplication changes decisions.
- Prefer one clear source of truth per topic.
- Update docs only when a high-level decision, boundary, or operator guideline changes.
- Do not list functions, methods, file inventories, or directory contents in docs. Agents can discover those from the code.
- Do not include migration notes, changelog entries, or transitional guidance in durable docs. Once a migration is complete, remove the notes.
- Documentation should cover what cannot be easily inferred from reading the code: vision, conventions, methodology, guidelines derived from experience, and architectural decisions.
- Scope documentation as close to its subject as possible. Prefer a local `AGENTS.md` over a global doc for directory-specific guidance.
- Documentation should not compensate for unclear code. If behavior can be made
  obvious through names, types, layout, or tests, improve those instead of
  adding explanatory text.

## Prompts

- Keep prompts concise and role-local.
- A prompt should explain what that agent or workflow is trying to do, not restate nearby architecture docs or task policy.
- Durable conventions and boundaries belong in local `AGENTS.md` files by default, not repeated across several prompts.
- If the same guidance appears in both a prompt and a nearby `AGENTS.md`, keep the durable version and trim the prompt.

## Engineering Rules

- Use `pnpm` for package scripts, dependency installation, and one-off package
  execution. Do not use `npm` unless the task explicitly concerns npm
  compatibility.
- Repo-level dependency install safeguards live in `pnpm-workspace.yaml`; keep
  package-manager policy exceptions narrow, named, and justified there.
- Optimize for the simplest, clearest, most maintainable final system, not for
  patch size. A larger cohesive change is better than a narrow edit that
  leaves confusing seams, duplicate concepts, or future cleanup.
- Prefer strict typed protocols. Do not add nullable fields, optional fields,
  defaults, fallbacks, compatibility shims, or dual paths unless absence is a
  real domain state and the behavior is explicit at the boundary.
- Fail loudly on malformed internal protocol data. Silent coercion belongs only
  at external I/O boundaries, and only when the normalized result is explicit.
- Do not add test-only production flags, hooks, or override parameters just to make tests easier.
- Prefer designs that are naturally testable through clear boundaries and explicit inputs and outputs.
- Avoid optimizing healthy mechanisms for speed or cost at the expense of quality, clarity, or capability.
- Prefer clear discoverable surfaces over injected context summaries. If an
  agent can gather context itself, do not precompute and force-feed it.
- Validate stable invariants in code; leave judgment-heavy review to agents with
  clear traces and useful tools. Do not replace agent judgment with brittle
  one-off evidence files or mandatory process rituals.
- Prefer internal package imports (`#core/*`, `#modules/*`, `#root/*`) for
  cross-tree imports. Keep `./` relative imports only for same-directory or
  tightly local siblings.
- Those package imports resolve to `src/` in source-mode dev/test runtime and
  to `dist/` in built runtime. Do not add parallel alias systems.
- Do not throttle core autonomous workflows with hard daily spend caps by
  default. If autonomy is wasteful, fix the queue, prompts, validation, repair
  flow, or operator controls before capping the workflows themselves.
- Treat runtime, workflow, and core-loop changes as high-risk and verify them more thoroughly than routine edits.

## AGENTS.md Files

- Every meaningful repo directory should have a local `AGENTS.md`.
- Each file should explain what belongs in the directory, its role in the system, and any important boundaries.
- Avoid implementation detail, file-by-file inventories, or repeated content from nearby docs.
- Aim for short files (~100 lines or less). When a file outgrows that, split detail into narrower-scope `AGENTS.md` files at child directories rather than expanding the parent.
- When two or three reasonable patterns exist for a recurring decision, name the choice and pick one as the default. Record rejected alternatives only when their rejection is load-bearing.
- Pair prohibitions with the canonical alternative ("don't X; use Y"). A bare "don't" without an alternative pushes agents into exploration.

## Maintenance

- Any agent or contributor may update these docs when structure or priorities change.
