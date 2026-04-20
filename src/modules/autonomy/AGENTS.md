# Autonomy Module

This module owns the project autonomous development loop.

- Keep the autonomous workflows inside this module.
- Shared helpers used only by these workflows belong here too.
- Do not recreate a parallel workflow catalog in core just to surface these workflows.
- Durable autonomous learning belongs in scoped `AGENTS.md` guidance at the
  narrowest useful directory. Evidence belongs in run artifacts and git history;
  do not create a second lessons store or inject stale summaries into prompts.
- Promote a lesson only when repeated run evidence shows a durable pattern.
  Retract or narrow guidance when code, behavior, or ownership changes.
- Workflow-specific prompts should stay role-focused. Shared policy and
  operating conventions belong in this module's `AGENTS.md` hierarchy.

## Harness And Eval Decisions (Anthropic Engineering Takeaways)

Decision-level takeaways from Anthropic's Mar 2026 harness-design,
infrastructure-noise, Claude-Code-auto-mode, managed-agents, and
demystifying-evals posts, mapped against KOTA's current design. Post
summaries live in run artifacts; only KOTA decisions belong here.

- **Generator / evaluator separation is already the right shape.**
  Decomposer → builder → critic mirrors the planner/generator/evaluator
  split. Do not collapse them into a single agent even as models improve.
  When stripping scaffolding, strip repair-loop checks or semantic gates
  first; keep the agent-role separation.
- **Evaluator must be able to probe outcomes, not only inspect artifacts.**
  The builder's critic today reads the diff and run artifacts. For tasks
  whose outcome lives outside repo state (runtime service behavior, UI,
  external API state), diff-only review is structurally blind. New tasks
  whose success hinges on runtime behavior must either reduce their
  success predicate to an inspectable artifact or carry a runtime probe
  as part of the task contract.
- **Infrastructure noise is not statistical noise.** Any KOTA eval
  harness must separate guaranteed resource allocation from kill
  thresholds, report resource profile per run, run each fixture multiple
  times, and distinguish `pass@k` (capability) from `pass^k`
  (consistency). A single-run score across a shared host is not a
  leaderboard signal.
- **Context resets beat compaction for long autonomy loops.** Prefer
  fresh-session handoffs through structured run artifacts over in-session
  compaction when a workflow has distinct phases. The existing run-dir
  handoff pattern is the correct shape; keep it.
- **Untrusted content entering agent context is an injection surface.**
  Explorer, web-access, read-document, and email ingest externally
  authored content. `"autonomous"` autonomy mode still relies on
  tool-level `RiskLevel` plus the approval queue. A dedicated
  input-side defense on web-fetched content is worth evaluating before
  autonomy scope broadens further; tool-risk gating alone does not
  classify payload content.
- **Session state should be reconstructible from append-only logs.**
  KOTA has run artifacts, event ring buffer, and `runtime.recovered` on
  workflows. Sessions live in daemon memory. Any new daemon-owned
  runtime state needs an answer for "what survives a daemon crash
  mid-turn" before it ships; default to writing through to run artifacts
  or the event bus rather than holding state only in process memory.
- **Eval fixtures come from real failures, not synthetic specs.** When
  the eval-harness module lands, seed it from `.kota/runs/` failures
  first. A fixture set assembled from hypothetical tasks is the
  anti-pattern the demystifying-evals post calls out.
