---
id: task-record-letta-memory-blocks-and-reflexion-self-refl
title: Record Letta memory-blocks and Reflexion self-reflection verdicts for KOTA
status: ready
priority: p3
area: autonomy
summary: Extend the autonomy peer-coordination verdict record to cover Letta's labeled memory_blocks pattern and Reflexion's verbal self-reflection loop, so both externally visible patterns have an explicit adopt/reject rationale grounded in KOTA's existing primitives
created_at: 2026-04-20T17:28:33.724Z
updated_at: 2026-04-20T17:28:33.724Z
---

## Problem

`src/modules/autonomy/AGENTS.md` records adopt/reject verdicts on peer-runtime
coordination primitives (crewAI Flows, LangGraph Pregel, Vercel AI SDK, OpenHands
/ AutoGen handoffs). That section exists so contributors tempted to adopt a
peer pattern can see whether KOTA already covers it, rejects it, or has
deferred. The catalog is incomplete on two patterns that currently sit on the
explorer watchlist with no recorded verdict:

- **Letta's labeled `memory_blocks`** — the headline Letta primitive is named,
  agent-selectable memory slots that persist across sessions. KOTA today owns
  multiple store types (`history`, `memory`, `knowledge`, `working memory`,
  `run artifacts`) plus provider-registry extensibility. Whether KOTA should
  adopt a Letta-style labeled-block surface on top of those, or deliberately
  keep the store-type split, is not recorded anywhere a future contributor
  would find it.
- **Reflexion's verbal self-reflection** — the Reflexion pattern writes a
  natural-language "lesson" from each failure and conditions the next attempt
  on the lesson log. KOTA already has an improver workflow that proposes
  scoped `AGENTS.md` edits, and `src/modules/autonomy/workflows/AGENTS.md`
  explicitly forbids a second lessons store ("Durable autonomous learning
  belongs in scoped AGENTS.md guidance... do not create a second lessons
  store or inject stale summaries into prompts"). The rejection rationale
  exists by implication but is not tied to the Reflexion pattern name, so a
  contributor reading the Reflexion paper can land a "let's try Reflexion"
  task without seeing the prior decision.

Both are live on `data/watchlist.yaml` with `status: seen` summaries. Neither
has a durable verdict.

## Desired Outcome

Two new verdict entries are added to the existing "Peer Coordination Pattern
Decisions" section (or a renamed section that accommodates memory and
self-reflection decisions cleanly) in `src/modules/autonomy/AGENTS.md`. Each
verdict:

- Names the peer pattern.
- States adopt / reject / defer.
- Identifies the KOTA primitive(s) that already cover the shape or explicitly
  justifies why KOTA's position differs.
- Cites the watchlist summary as the evidence anchor.

After this task, a contributor reading Letta docs or the Reflexion paper will
find KOTA's stance in one place instead of reconstructing it from multiple
AGENTS.md files.

## Constraints

- Do not invent a new catalog file or a second verdicts surface. The existing
  autonomy-module AGENTS.md section is the single place for these verdicts.
- Do not restate peer-runtime summaries in the verdict body — those live in
  `data/watchlist.yaml` and its snapshots. The verdict cites, not duplicates.
- Do not preemptively adopt a pattern just to have something to record. If
  KOTA's current position is "reject, already covered", record that with the
  existing primitive named.
- Keep the section within the instruction-file cap. If adding both verdicts
  would push `src/modules/autonomy/AGENTS.md` over its limit, split the verdict
  catalog into a scoped subdirectory AGENTS.md rather than trimming unrelated
  content.
- No code changes; this is durable decision capture.
- Do not change `data/watchlist.yaml` as part of this task — the verdicts are
  derived from the existing watchlist record.

## Done When

- `src/modules/autonomy/AGENTS.md` contains explicit verdicts for both the
  Letta memory-blocks pattern and the Reflexion verbal self-reflection loop,
  each naming the KOTA primitive that covers the shape or the rationale for
  differing.
- The two verdicts are discoverable from the same section that already covers
  crewAI Flows, LangGraph Pregel, Vercel AI SDK, and OpenHands / AutoGen.
- The instruction-file cap still passes for the edited AGENTS.md.
- No new catalog file, duplicate surface, or code change was introduced.
