---
id: task-turn-knowledge-capture-into-evidence-based-learnin
title: Turn knowledge-capture into evidence-based learning
status: done
priority: p2
area: autonomy
summary: Promote recurring signals into durable AGENTS.md guidance instead of per-run journal entries.
created_at: 2026-04-17T09:02:15.099Z
updated_at: 2026-04-17T13:06:14.604Z
---

## Problem

`knowledge-capture` today writes one markdown file per successful builder/improver run into `.kota/data/` (type `run-insight`, body = task title + commit message + files changed + duration), and retrieval is keyword text-search. That is a per-run journal, not an accumulating knowledge base. Real *learnings* — non-obvious rules, patterns, and guidelines discoverable only from recurring signals across many runs — never graduate into a form that future agents actually read. The project direction is that such knowledge should live in scoped `AGENTS.md` files (not a separate lessons silo) and should be evidence-based: the system should distinguish between "agent forgets instructions," "instructions unclear," and "no instructions exist."

## Desired Outcome

The autonomy loop reliably promotes recurring signals into durable `AGENTS.md` guidance at the correct scope (narrowest applicable directory), backed by linkable evidence (run IDs, failure traces, repair-loop hits), without letting any one `AGENTS.md` grow unbounded or drift from the code. Per-run journaling is retained only where it genuinely feeds distillation; ephemeral run logs and durable guidance are clearly separated.

## Constraints

- Lessons must not accumulate in a parallel surface like `data/lessons/` or `LESSONS.md`. Durable conventions live in `AGENTS.md` at the narrowest scope; this task must respect that boundary.
- Retrieval must stay contextual — improver/builder/explorer should read the right scoped `AGENTS.md` at prompt-construction time, not be force-fed a giant injected context blob.
- Evidence must be traceable: any rule added autonomously should point back to concrete run IDs or signals, so a human can audit whether the signal actually supports the rule.
- De-duplication and expiry are required; stale rules must be pruned, not left as sediment.

## Done When

- A concrete design for evidence-based rule distillation is documented (step inside knowledge-capture vs. separate periodic workflow, promotion criteria, retraction criteria).
- There is an agreed mechanism for updating `AGENTS.md` files autonomously with supporting evidence attached (commit-linked or trace-linked), and it passes existing validation.
- Redundant per-run journal writes that don't feed distillation are removed.
- Improver/builder/explorer prompts or tool surfaces pull scoped `AGENTS.md` context at the right granularity, without duplicating it into a separate knowledge silo.

