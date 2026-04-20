---
id: task-distill-takeaways-from-openai-research-posts-into-
title: Distill takeaways from OpenAI research posts into KOTA autonomy decisions
status: done
priority: p2
area: autonomy
summary: Read the durable autonomy-adjacent OpenAI research posts already visible on the watchlist (instruction hierarchy, chain-of-thought monitorability, SWE-bench Verified retirement, Model Spec), and record only the decisions that change KOTA design in the autonomy AGENTS.md scope
created_at: 2026-04-20T19:16:32.555Z
updated_at: 2026-04-20T20:20:50.192Z
---

## Problem

KOTA's autonomy module already carries a distillation of Anthropic engineering
posts on harness design, infrastructure noise, Claude Code auto mode, and
managed agents (see `src/modules/autonomy/AGENTS.md` — "Harness And Eval
Decisions"). That work shaped concrete decisions the module relies on today
(generator/evaluator separation, infra-noise-aware eval harness, injection
defense on web-derived content, run-artifact handoffs over compaction).

The OpenAI research blog is on the explorer watchlist with `status: seen`,
and the watchlist summary names four durable autonomy-adjacent threads:

- instruction-hierarchy-challenge
- why-we-no-longer-evaluate-swe-bench-verified
- evaluating-chain-of-thought-monitorability
- the Model Spec posts

None of these has been read against KOTA's current design. Each one directly
maps to a KOTA-owned subsystem:

- *Instruction hierarchy* → system-prompt composition, injection defense, and
  how autonomy-mode-scoped session instructions interact with user messages
  and module-contributed prompt state (`src/modules/injection-defense/`,
  `src/core/loop/pre-send-hooks.ts`, `src/core/agent-sdk/`).
- *Chain-of-thought monitorability* → critic / evaluator design and the
  agent-judge runtime contract (`src/modules/autonomy/AGENTS.md` judge
  contract, `src/modules/autonomy/workflows/builder/`).
- *Why no longer SWE-bench Verified* → eval harness fixture sourcing
  (`src/modules/eval-harness/AGENTS.md` already says fixtures come from real
  `.kota/runs/` failures; the OpenAI post may validate, refine, or contradict
  that stance).
- *Model Spec* → autonomy-mode design and operator/agent hierarchy
  (`src/core/tools/AGENTS.md` autonomy-mode rules).

Without an honest read-through, KOTA risks reinventing patterns that are
already documented externally or missing safety/oversight affordances peers
have already adopted. The reverse is also possible: a decision OpenAI
documented may be wrong for KOTA's shape, and the verdict file should record
that too rather than leaving the pattern undecided.

## Desired Outcome

- Each listed post is fetched and read against KOTA's current design.
- One short, durable distillation section is added to
  `src/modules/autonomy/AGENTS.md` (or a scoped subdirectory `AGENTS.md` if
  the size cap would be breached — see existing harness/eval takeaways and
  peer-coordination verdicts for the shape).
- The section captures only takeaways that change a KOTA decision. It does
  not summarize the posts. It names the KOTA subsystem affected, the decision
  taken (adopt / reject / defer), and the evidence anchor (watchlist summary
  or run-artifact id).
- For each KOTA-specific gap the distillation surfaces, a concrete follow-up
  task is opened in `data/tasks/backlog/`. Follow-ups are not implemented as
  part of this task.
- Posts that turn out not to inform a KOTA decision are recorded as
  "read, no action" in the run capture trail, not silently dropped.

## Constraints

- This is a research-and-synthesis task. It does not itself land runtime,
  prompt, or workflow changes — the follow-up tasks do.
- The durable note must be short and decision-focused. It must not become a
  blog-post summary or an external link catalog inside durable docs.
- Do not duplicate the content of the `data/watchlist.yaml` snapshot. The
  watchlist carries the per-URL summary; the AGENTS.md note carries the
  KOTA consequence.
- Respect the inaccessible-source rule (root `AGENTS.md`). Posts that cannot
  be fetched must be honestly dispositioned (create a follow-up blocked task
  or mark this task blocked, do not silently skip). A "done" record that
  lists inaccessible sources without honest handling is a validation error.
- Keep the scope to OpenAI-published research posts. Do not digest DeepMind,
  Google Research, or peer runtimes in the same task; those are separate
  follow-up opportunities.
- Do not reopen unrelated architectural choices in the same note. If a post
  surfaces a large decision, open a dedicated follow-up task rather than
  settling it inline.
- Stay within the instruction-file cap on the edited `AGENTS.md`. Split into
  a scoped subdirectory `AGENTS.md` if needed rather than trimming unrelated
  content.

## Done When

- A short distillation section exists in `src/modules/autonomy/AGENTS.md` (or
  a scoped subdirectory `AGENTS.md`) that names KOTA-affecting decisions
  derived from the four OpenAI research threads listed above.
- Every listed post is either read with a recorded takeaway or honestly
  dispositioned as inaccessible / off-scope / "read, no action".
- Concrete follow-up tasks exist for every KOTA-specific gap the
  distillation surfaces; this task does not itself implement them.
- The instruction-file cap still passes for the edited AGENTS.md.
- No new catalog file, duplicate surface, or code change was introduced by
  this task.
