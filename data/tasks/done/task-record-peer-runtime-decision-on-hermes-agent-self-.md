---
id: task-record-peer-runtime-decision-on-hermes-agent-self-
title: Record peer-runtime decision on Hermes Agent self-improving skills and FTS5 session search
status: done
priority: p2
area: architecture
summary: Evaluate Hermes Agent's closed-loop autonomous skill generation, FTS5+LLM session search, and Agentskills.io skill interop against KOTA's module/workflow/session model and record an adopt/reject verdict in the autonomy peer-runtime decisions.
created_at: 2026-04-22T19:39:08.593Z
updated_at: 2026-04-22T20:02:09.234Z
---

## Problem

`data/watchlist.yaml` added `https://github.com/nousresearch/hermes-agent` on
2026-04-22 as a direct peer to KOTA's `module` + `workflow` + `session` model.
Its watchlist summary names several externally visible runtime patterns that
are not yet judged against KOTA's protocols:

- A closed learning loop in which agents curate persistent memory and
  autonomously generate/refine skills at runtime.
- FTS5 session search with LLM-driven summarization as the long-horizon
  memory/retrieval mechanism.
- Agentskills.io interop as a community skill marketplace distribution model.

The existing "Peer Runtime Pattern Decisions" block in
`src/modules/autonomy/AGENTS.md` already carries adopt/reject verdicts for
crewAI Flows, LangGraph Pregel, Vercel AI SDK, OpenHands / AutoGen handoffs,
Letta memory blocks, and Reflexion self-reflection. Without a Hermes entry,
operators and future runs cannot tell whether Hermes's distinguishing
patterns should reshape KOTA's protocols or are already covered.

## Desired Outcome

`src/modules/autonomy/AGENTS.md` gains a Hermes Agent entry in the
"Peer Runtime Pattern Decisions" block with a short adopt/reject verdict per
distinguishing pattern and the KOTA subsystem each maps to. Patterns already
covered by adopted or rejected entries (MCP tools, cron-style scheduling,
parallel subagent delegation) are pointed back to those existing decisions
rather than re-adjudicated.

If any pattern is adopted, a focused follow-up task is opened in
`data/tasks/backlog/` describing the concrete protocol or module change;
rejections need only the rationale in the decision entry.

## Constraints

- Keep the entry decision-level and short, matching the existing block's
  style. Do not paraphrase Hermes's README into KOTA's docs.
- Anchor each verdict against a specific KOTA protocol boundary (module,
  workflow, session, store, agent, skill) named in `src/AGENTS.md` or
  `src/modules/AGENTS.md`.
- Treat `skills` as KOTA already defines them — reusable guidance with
  optional supporting assets contributed by modules. Do not silently
  redefine skills to match Hermes's runtime-generated-skill usage without
  an explicit decision.
- No second durable lessons-or-decisions surface. The entry lives in the
  existing autonomy-module `AGENTS.md` block; do not create a parallel
  peer-runtime catalog elsewhere.
- Do not weaken KOTA's "modules are the only packaging/integration unit"
  rule to accommodate a community skill marketplace without explicit
  operator scope and secrets/trust implications called out in the entry.

## Done When

- `src/modules/autonomy/AGENTS.md` has a Hermes Agent bullet (or bullets)
  in "Peer Runtime Pattern Decisions" covering at minimum the autonomous
  skill-generation loop, FTS5 + LLM-summarized session search, and the
  Agentskills.io skill-interop pattern, with an explicit adopt/reject
  verdict and named KOTA subsystem for each.
- Patterns already adjudicated elsewhere (MCP, cron, parallel subagents)
  are cross-referenced rather than duplicated.
- For any adopted pattern, a follow-up backlog task captures the concrete
  KOTA-side change; rejections carry their rationale inline.
- No other doc surface duplicates the verdict; `data/watchlist.yaml`'s
  Hermes entry is unchanged.
