# Standards

## Repository Surfaces

- `docs/` is for durable, cross-cutting reference docs.
- `data/inbox/` is for quick captures, rough ideas, and owner notes.
- `data/tasks/*.md` is the normalized active work queue; terminal task history
  lives under `data/tasks/archive/`. Active task state is only `open` or
  `blocked`; an active builder run is the transient in-progress projection.
- Local `AGENTS.md` files explain directory purpose and boundaries.
- Git history, `.kota/runs/`, and terminal task records in
  `data/tasks/archive/` are the historical record. Do not add parallel
  changelog, audit, or lesson surfaces.
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
- Keep mutable operational and scope state in the revisioned
  `RunStateDatabase` API. `WorkflowRunStore` owns retained run evidence only;
  runtime summaries are projections from SQLite and current in-memory timers.
  Offline readers must receive the canonical state root explicitly and open it
  read-only; schema migration and obsolete-state disposal belong to daemon
  startup, never inspection or standalone execution.
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
- Encode contracts at the narrowest authoritative layer. Use types for internal
  structure, schemas and decoders for untrusted data, package boundaries for
  visibility, generators for language projections, and runtime policy for
  admission or resource rules. Tests prove the behavior of those mechanisms;
  they are not the mechanism that makes an implementation conform.
- A shared contract suite applies only to implementations that explicitly
  declare that contract or capability. Give the suite semantic examples that
  every declared implementation must satisfy, and keep implementation-specific
  behavior in the owning component. Do not make every implementation inherit a
  growing universal checklist.
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
- Treat fixtures as representative inputs, boundary recordings, or authored
  semantic examples. Do not turn copied catalogs, file trees, private object
  shapes, or byte-identical source mirrors into product contracts. Generate
  structural cross-language bindings from one source and author only the
  semantic examples that generation cannot express.
- Test doubles may replace slow or external ports such as clocks, networks,
  credentials, and subprocess launchers. They must not reimplement workflow,
  module, transport, persistence, or lifecycle semantics. Exercise those
  semantics through the production host with controlled ports.
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

## Verification Admission Model

Every verification mechanism admitted or retained in KOTA must satisfy the
six-dimension admission model:

1. **Consumer**: Who relies on the behavior (human operator, API client, protocol peer, autonomous agent, runtime kernel).
2. **Production Owner**: The single cohesive subsystem or module that owns the domain behavior.
3. **Public Stimulus**: The public API call, CLI command, wire message, or typed event that invokes the behavior.
4. **Observable Oracle**: The observable return value, persisted state mutation, emitted event, wire response, or process effect that proves success.
5. **Distinct Failure**: The concrete, distinct defect or regression caught that no existing structural mechanism catches.
6. **Cadence**: The dedicated, non-overlapping validation portfolio that executes the check.

### Alternative Proof Mechanisms

Tests are not the sole proof mechanism. Treat the following architectural mechanisms as primary alternative proofs:

- **Strict Types**: Eliminates null, undefined, invalid variant, and missing field errors at compile time.
- **Schemas & Decoders**: Validates and normalizes untrusted boundary inputs with explicit rejection.
- **Generators**: Structural cross-language bindings eliminate manual wire parsing and model sync boilerplate.
- **Registries & Immutability**: Single-point capability and tool registration prevents duplicate or mismatched runtime handlers.
- **Static Inspection**: Biome linting and project references catch architectural violations and module cycle risks.
- **Runtime Probes & Journeys**: Proves real operator experiences and CLI/UI workflows without artificial test mocks.

Review guidance explicitly permits **omitting new tests when an architectural mechanism already proves the behavior**. Remove mechanical demands for coverage percentages, test counts, artifact presence, or source scans.

The repository baseline and exhaustive disposition manifest for all 115 test families and large files are cataloged in [`docs/VERIFICATION_BASELINE.md`](file:///Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/worktrees/2026-08-27t05-01-18-980z-builder-b39a4dd099ca9593a779273d5c0fd5c2a7d3b7a3e56dfdcddf9471cb05d88ce0/docs/VERIFICATION_BASELINE.md).

## Validation Cadence

Validation is selected from the behavior and owner affected by a change. These
portfolios have explicit membership and no accidental overlap.

| Cadence | Command | Scope & Membership | Purpose |
| --- | --- | --- | --- |
| deterministic fast | `pnpm check:fast` | Typecheck production and test/support projects, lint source, and validate task integrity. | Fast deterministic static gate. |
| owner behavior | `pnpm test:owner` | `src/**/*.test.ts` (excluding CLI, eval, integration, protocol, resilience) | Exercise the decisions and observable behavior owned by the changed component. |
| protocol | `pnpm test:protocol` | MCP client/server protocol, OAuth endpoint/redirect policy, ACP wire formats | Exercise wire compatibility, framing, redirect, OAuth, and interoperability behavior. |
| resilience | `pnpm test:resilience` | `foreign-module-resilient.test.ts`, `module-error-resilience.integration.test.ts` | Exercise failure isolation and recovery scenarios that are intentionally slower than owner feedback. |
| component integration | `pnpm test:integration` | `src/**/*.integration.test.ts` (excluding CLI, resilience) | Exercise declared multi-owner process, persistence, network, or runtime-host boundaries. |
| evaluation | `pnpm test:eval` | `src/modules/eval-harness/**/*.test.ts` | Exercise eval-harness behavior and replay-backed workflow smoke cases without invoking live model fixtures. |
| CLI | `pnpm test:cli` | `src/cli.test.ts`, `src/module-cli-commands.integration.test.ts` | Exercise CLI subcommands, argument parsing, and terminal interface commands. |
| broad confidence | `pnpm check` | Full build + all non-overlapping test partitions | Build production output and run all server test partitions on main, schedule, release, or a deliberately broad high-risk change. |

Tests without an explicit cadence stay with their behavior owner. Security and
restart scenarios stay beside that owner; protocol and resilience scenarios
use their explicit projects and do not need parallel global copies. Vitest's
changed-file selection is useful feedback, but changes to
schemas, configuration, generated data, or runtime reach still require
engineering judgment about affected owners.

The production TypeScript build excludes repository tests, internal test
support, and eval fixture projects. A separate test TypeScript project keeps
those sources type-safe. Generated-binding freshness runs as part of the owner
build; each native client builds and tests only when its own source or a shared
generated contract changes.

## AGENTS.md Files

- Every meaningful repo directory should have a local `AGENTS.md`.
- Each file should explain what belongs in the directory, its role in the system, and any important boundaries.
- Avoid implementation detail, file-by-file inventories, or repeated content from nearby docs.
- Aim for short files (~100 lines or less). When a file outgrows that, split detail into narrower-scope `AGENTS.md` files at child directories rather than expanding the parent.
- When two or three reasonable patterns exist for a recurring decision, name the choice and pick one as the default. Record rejected alternatives only when their rejection is load-bearing.
- Pair prohibitions with the canonical alternative ("don't X; use Y"). A bare "don't" without an alternative pushes agents into exploration.

## Maintenance

- Any agent or contributor may update these docs when structure or priorities change.
