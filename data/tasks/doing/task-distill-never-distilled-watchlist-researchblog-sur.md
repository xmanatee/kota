---
id: task-distill-never-distilled-watchlist-researchblog-sur
title: Distill never-distilled watchlist research/blog surfaces into autonomy AGENTS decisions
status: doing
priority: p2
area: research
summary: Four autonomy-adjacent watchlist surfaces (claude.com/blog, anthropic.com/research, deepmind.google/discover/blog, research.google/blog) have snapshot summaries but no adopt/reject verdict in src/modules/autonomy/AGENTS.md, unlike Anthropic engineering and OpenAI research which were already distilled. Produce one distillation pass that turns each into decision-level entries or explicit non-adoption notes.
created_at: 2026-04-22T22:34:29.619Z
updated_at: 2026-04-22T22:35:56.568Z
---

## Problem

`src/modules/autonomy/AGENTS.md` already carries "Harness And Eval
Decisions" (distilled from Anthropic engineering) and "OpenAI Research
Distillation" (distilled from openai.com/research). Four more
autonomy-adjacent watchlist surfaces have snapshot summaries but no
matching adopt/reject block:

- `claude.com/blog` — lands Claude Code parallel-agents / subagents,
  agent-coordination strategy, Claude Managed Agents productionization,
  and tool-design-for-agents posts; directly adjacent to KOTA's
  `delegate` tool, sub-agent model, `agent-harness` protocol, and tool
  metadata surface.
- `anthropic.com/research` — Automated Alignment Researchers, Trustworthy
  agents in practice, and model-behavior-diff tooling pieces; adjacent to
  KOTA's evaluator calibration and agent-judge runtime contract.
- `deepmind.google/discover/blog` — "Measuring progress toward AGI
  cognitive framework", Gemma Scope 2 interpretability, and
  harmful-manipulation safety posts; adjacent to KOTA's evaluation
  methodology and injection-defense posture.
- `research.google/blog` — rater sufficiency, alignment of behavioral
  dispositions, synthetic-data design, and user-simulator realism pieces;
  adjacent to KOTA's autonomy eval harness and agent-judge calibration.

Without a decision pass, these surfaces keep refreshing on the watchlist
without ever changing KOTA's protocols. Operators and future runs cannot
tell whether any of their distinguishing patterns should reshape KOTA or
are already covered.

## Desired Outcome

One distillation pass lands verdicts for every autonomy-adjacent thread
in each of the four surfaces above. The verdicts sit next to the existing
"Harness And Eval Decisions" / "OpenAI Research Distillation" blocks in
`src/modules/autonomy/AGENTS.md` (or in scoped `AGENTS.md` files when the
decision is module-local). Each verdict is decision-level — "adopt",
"reject", or "already covered by existing KOTA primitive X" — and names
the specific KOTA protocol, module, tool, or bus event it compares
against. Snapshot summaries stay on the watchlist; only decisions live in
`AGENTS.md`.

## Constraints

- Follow the existing distillation style. Bullet verdicts grouped by
  source, decision first, then the KOTA primitive it maps onto or
  displaces.
- Do not copy post summaries into `AGENTS.md`. The watchlist snapshot
  already holds the summary; durable docs carry only KOTA decisions.
- Do not add a parallel lessons store, post index, or per-source changelog.
- Cover the thread's distinguishing pattern, not every bullet in the post.
  A thread that reinforces a primitive KOTA already ships is an
  "already covered" entry, not a new block.
- Fetch failures are first-class. If a source is inaccessible, record it
  honestly under the blocker protocol rather than inventing a verdict.
  `openai.com/*` precedent applies: do not claim distillation from a
  page autonomy could not load.
- Do not retroactively revise earlier distillations while adding new
  verdicts; if a prior verdict turns out wrong, flag it as a separate
  follow-up rather than editing it inline.
- Keep the decision-level scope. Module-specific contracts still belong
  in the owning module's `AGENTS.md` with a one-line pointer from the
  autonomy block.

## Done When

- `src/modules/autonomy/AGENTS.md` (or the appropriate scoped
  `AGENTS.md`) carries a decision block for every autonomy-adjacent
  thread on the four surfaces.
- Each verdict is decision-level and names the KOTA primitive it
  compares against.
- Watchlist snapshots for the four surfaces stay intact; no summary
  content leaks into `AGENTS.md`.
- Any inaccessible source is recorded honestly in the task body with a
  follow-up task, not papered over with a fabricated verdict.
- A run artifact captures which threads were read and which verdict each
  produced, so a future explorer can rerun the pass against a newer
  snapshot without reopening settled calls.

## Plan

- Read the four surfaces through whatever path autonomy has available
  (plain fetch today; rendered-browser once operator provisions
  Playwright + auth profiles). Record the URL, title, and fingerprint
  per thread in the run artifact.
- For each thread, write one decision in the same style as the existing
  blocks. Cross-check against current KOTA modules, tools, protocols,
  and bus events before calling a pattern "already covered".
- If a thread's verdict belongs in a module-local `AGENTS.md`, land it
  there and add a one-line pointer from the autonomy block.
- If a source cannot be read, file (or reuse) a blocker task for the
  operator-facilitated unblock and mark the verdict as pending rather
  than guessing.
