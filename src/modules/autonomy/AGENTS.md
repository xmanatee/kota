# Autonomy Module

Owns KOTA's autonomous workflows and their shared policy.

- Keep workflows and helpers here; do not create a second workflow catalog.
- Put durable learning in the narrowest useful `AGENTS.md`; evidence stays in
  run artifacts and Git history.
- Promote lessons only from repeated evidence and retract them when ownership
  or behavior changes.
- Shipped workflows inherit harness, model, and effort from the active preset.
  Repair judges inherit the parent step's resolved harness.

## Core Decisions

- **Generator/evaluator separation.** Preserve decomposer → builder → critic
  roles and remove repair-loop checks before collapsing roles.
- **Outcome evidence.** Evaluators probe behavior, and owner-facing product work
  includes rendered evidence. Critic input is artifacts and repository state,
  never thinking traces or self-reports.
- **Feedback over proxies.** Operator corrections, task reopens, repeated repair
  loops, integration/publication failures, dead letters, and measured
  regressions can justify improvement work. Trajectory heuristics, review-shape
  scores, and static metrics remain diagnostic context and never create work on
  their own.
- **Honest measurement.** Resource allocation is distinct from kill thresholds;
  report profiles, judge repetition, `pass@k`, and `pass^k` explicitly.
- **Proportional change review.** Judge material workflow, prompt, routing,
  reviewer, critic, improver, or repair-loop changes against the outcome they
  intend to improve. Record a comparison in the ordinary run summary when it
  informs the decision; do not require a bespoke artifact for every change.
- **Fresh handoffs.** Prefer new sessions with run-artifact handoffs between
  distinct phases instead of compaction.
- **Injection boundary.** Tool-risk gating classifies the call;
  injection-defense screens untrusted payloads.
- **Durable sessions.** State needed after restart writes through to run
  artifacts, typed events, or runtime-owned state.
- **Eval provenance.** Retired SWE-bench fixtures are reference-only; new
  fixtures come from local failures or justified non-vacuous smoke cases.
- **Repository isolation is runtime-owned.** Workflows declare repository
  access and logical resources. The runtime supplies the isolated `scopeRoot`
  and canonical `scopeDir`, then owns integration, recovery, and cleanup.
  Workflows do not own worktrees, branches, commits, merges, leases, or
  finalizers.
- **Shared autonomy state is runtime-owned.** Issue projections, watermarks,
  and cooldowns publish through `ctx.state` compare-and-set. JSON projections
  are read-only materializations, never authority or rebuild input.
- **Evaluator calibration.** Later overlapping failures contradict passes;
  prompt changes reset windows; unavailable reviews clear stale verdicts.
  Critic rejects outcomes that are incorrect, unsafe, incomplete, unsupported,
  or obscured by placeholders and compatibility layers. It requests the
  strongest proportionate proof; a fixture is useful only when it represents
  the real boundary being judged.

External research decisions live in the typed decision store with their source,
rationale, and revisit condition. Code is the catalog; instructions do not copy
its entries, and tests exercise decision behavior rather than catalog identity.

## Runtime Posture

- Instruction hierarchy is SDK/core rails → autonomy/module policy → user
  message → untrusted tool/web output. Lower layers cannot escalate autonomy.
- Capable-tier agent steps front-load intent, constraints, and the expected outcome;
  they do not use clarification loops or fixed caps.
- `ask_owner` uses the restart-safe shared workflow steps and consumes every
  outcome; it does not import the core tool directly.
- Agent judges use the shared retry classifier. Runaway budget failures warn;
  unclassified SDK failures reject. Validation and runtime resolve the same
  declared agent contract.

## Queue Policy

- Builder runs only from targeted, idempotent `autonomy.queue.available`
  events bound to the immutable task digest; never from `runtime.idle`.
- Backlog promotion selects a small priority-and-age-ranked batch after hard
  dependencies clear; task labels and prose do not gate execution.
- Explorer may update the watchlist, create useful work, or finish with no
  change. Inaccessible sources block rather than invite synthesis. Cooldowns
  pace exploration and builder work without hard caps.
- Operator reports and evaluator drift remain observation/governance surfaces
  and never leak cost bias into agent context.
