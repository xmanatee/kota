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
- Use Diátaxis as the documentation lens: tutorials, how-to guides, reference,
  and explanation are different jobs and should not be blended.
- Use FAIR, W3C Data on the Web Best Practices, and SKOS as data-organization
  lenses: make facts findable, explicitly linked, interoperable through typed
  schemas, and reusable without copying them into parallel prose catalogs.
- Distill external best practices into local decisions. Do not keep external
  link catalogs in durable docs unless the links themselves are the maintained
  product surface.

## Prompts

- Keep prompts concise and role-local.
- A prompt should explain what that agent or workflow is trying to do, not restate nearby architecture docs or task policy.
- Durable conventions and boundaries belong in local `AGENTS.md` files by default, not repeated across several prompts.
- If the same guidance appears in both a prompt and a nearby `AGENTS.md`, keep the durable version and trim the prompt.

## Workflow Execution

- Declare `repository: "none" | "read" | "write"` on every workflow. Writers
  also declare integration validation; use logical resource keys for domain
  work that must be exclusive.
- Treat `RunStateDatabase`, `RunCoordinator`, `RunLifecycle`, and
  `IntegrationQueue` as the shared ownership chain. Workflows define semantic
  steps, not private queues, claims, worktrees, leases, process registries,
  port allocators, commits, merge gates, or restart recovery.
- Keep Git publication runtime-owned. AI may repair reported conflicts or
  validation failures inside the supplied sandbox and write scope, while the
  runtime retains staging, rebase, commit, no-progress, cancellation, and
  publication authority.

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
- Test configuration consumers, not copies of configuration data. Schema and
  validator tests should exercise accepted and rejected shapes; resolution and
  integration tests should exercise precedence, propagation, no-fallback
  behavior, and observable effects. Inspect literal registries directly unless
  a generated projection is being compared with its canonical source.
- Give each behavior one owning test layer. Prefer a focused unit test for pure
  decisions, a component test for one real boundary such as SQLite, Git, or a
  child process, and a small end-to-end test only for a distinct product
  journey that crosses several boundaries.
- Assert public outcomes and durable invariants, not private phases, helper
  call counts, source text, filenames, or constructor placement. Structural
  source scans are appropriate only for security boundaries that cannot be
  expressed through types, runtime behavior, or package visibility.
- Keep integration suites intentionally small. A new integration scenario must
  identify the failure mode it uniquely catches; remove the replaced scenario
  or implementation-specific suite in the same change.
- Test generic parameters once over representative values. Do not duplicate a
  concurrency, retry, or capacity scenario for each configured number.
- Test workflow execution through durable outcomes and owner boundaries:
  admission, resource ownership, capacity, pause/resume, child waits, sandbox
  lifecycle, process/effect recovery, validation, and serialized publication.
  Do not pin private phases, file layouts, or retired queue mechanics.
- Avoid optimizing healthy mechanisms for speed or cost at the expense of quality, clarity, or capability.
- Owner-visible product quality outranks internal meta-work. When CLI, client,
  daemon status, approvals, owner requests, setup, or blocked-work visibility
  is materially confusing, fix that operator path before adding repair loops,
  micro-optimizations, or test-only hardening, unless the competing work is a
  safety issue or a runtime-stopping failure.
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
- Product-facing client and operator work is complete only when the real
  operator journey is inspectable through a rendered transcript, screenshot,
  runtime probe, or equivalent artifact. Passing unit tests alone does not
  prove that a CLI, Mac, Web, channel, setup, or daemon-control path improved.

## AGENTS.md Files

- Every meaningful repo directory should have a local `AGENTS.md`.
- Each file should explain what belongs in the directory, its role in the system, and any important boundaries.
- Avoid implementation detail, file-by-file inventories, or repeated content from nearby docs.
- Aim for short files (~100 lines or less). When a file outgrows that, split detail into narrower-scope `AGENTS.md` files at child directories rather than expanding the parent.
- When two or three reasonable patterns exist for a recurring decision, name the choice and pick one as the default. Record rejected alternatives only when their rejection is load-bearing.
- Pair prohibitions with the canonical alternative ("don't X; use Y"). A bare "don't" without an alternative pushes agents into exploration.

## Maintenance

- Any agent or contributor may update these docs when structure or priorities change.
