---
id: task-add-work-memory-provenance-and-correction-signals
title: Add work-memory provenance and correction signals
status: done
priority: p1
area: knowledge
task_class: Platform
summary: Make memory, knowledge, and recall results carry reviewable source, freshness, correction, and retraction signals so long-running agents learn from work without trusting stale context.
created_at: 2026-06-24T15:44:37.334Z
updated_at: 2026-06-24T22:16:32.000Z
---

## Problem

KOTA already has separate stores for memory, knowledge, working memory,
history, tasks, run artifacts, and recall. That separation is good, but the
cross-store recall surface still mostly answers "what matched?" rather than
"where did this belief come from, when was it last true, and did later work
correct it?"

The Perplexity Brain article is useful because it shifts memory from user
preferences to work history: what the agent did, what worked, what failed, and
what corrections were made. KOTA has the right raw material in run artifacts,
git history, task files, `retract`, memory, and knowledge, but those signals are
not consistently attached to recallable entries. A long-running workflow can
therefore retrieve stale context without a visible provenance or correction
trail.

## Desired Outcome

Memory, knowledge, and recall results expose reviewable provenance and
freshness signals without adding a parallel memory graph. A recalled item should
make clear, when available:

- the source run/session/file/URL/tool output that produced it;
- when it was created and last updated;
- whether it has been corrected, superseded, or retracted;
- which owning store is authoritative for editing or deleting it; and
- enough trace detail for an operator or later agent to inspect the original
  evidence instead of trusting a free-floating summary.

The first implementation slice should focus on one or two stores plus recall
rendering rather than boiling the ocean, but the contract should be extensible
to every first-party recall contributor.

## Constraints

- Keep canonical ownership in the existing stores. Do not create a second
  Brain-style graph, lessons store, or auto-injected summary layer.
- Store extra provenance as typed metadata at the owning store boundary where
  the store can validate it. Do not infer provenance later from filenames or
  prose.
- Preserve `retract` as the removal/correction path for invalid records; do not
  invent a separate delete protocol.
- Do not expose raw prompts, credentials, private connector payloads, cost
  ledgers, or large unbounded tool outputs in recall results.
- Keep semantic sidecar indexes as indexes only. They may index provenance text
  where useful, but they must not become the canonical source of truth.
- Prefer explicit stale/superseded signals over silent ranking penalties.

## Done When

- At least memory and knowledge entries can carry validated provenance metadata
  such as source kind, source id/path/URL, observed timestamp, and optional
  superseded/retracted status.
- Recall contributor output and `renderRecallHitsPlain` include concise
  provenance/freshness details where present, with conformance fixture updates
  for shared clients.
- The memory/knowledge CLI or daemon routes expose enough metadata for an
  operator to inspect and correct a stale entry.
- A retraction or correction path is demonstrated end to end: an entry is
  retrieved through recall, corrected or retracted through the owning store, and
  later recall output reflects the changed state.
- Focused tests cover provenance parsing, missing provenance, stale/superseded
  rendering, correction/retraction behavior, and semantic-index compatibility.

## Source / Intent

Owner asked on 2026-06-24 to turn recent agent-system resources into KOTA tasks
that improve the project, with references left for future agents to research.

Source resources to reread:

- https://www.perplexity.ai/hub/blog/self-improving-memory-for-agents
- https://openai.com/index/codex-maxxing-long-running-work/
- https://jxnl.co/writing/2026/05/10/codex-maxxing/

Local mapping:

- `src/modules/memory/` owns persistent agent notes.
- `src/modules/knowledge/` owns structured markdown-plus-frontmatter entries.
- `src/modules/recall/` merges knowledge, memory, history, tasks, and answer
  history.
- `src/modules/retract/` already owns cross-store deletion/retraction.
- `src/modules/autonomy/AGENTS.md` says durable autonomous learning belongs in
  scoped `AGENTS.md`, run artifacts, and git history rather than a second
  lessons store.

## Initiative

Trustworthy long-running memory: KOTA should learn from prior work while making
source, freshness, and correction state visible enough to audit.

## Acceptance Evidence

- Focused test transcript for the affected memory, knowledge, recall, and
  retract paths.
- Updated cross-client recall conformance fixture showing provenance/freshness
  rendering.
- CLI or HTTP transcript under `.kota/runs/<run-id>/` showing a record created
  with provenance, recalled, corrected/retracted, and recalled again with the
  changed state visible.

## Completion Notes

Implemented a typed work-memory metadata contract for memory and knowledge
entries, route and CLI exposure for create/update/read/list/search surfaces,
recall contributor and renderer propagation, semantic-store compatibility, and
cross-client conformance rendering for web, mobile, and Apple clients.

The retraction/correction path is demonstrated in
`.kota/runs/2026-06-24T21-48-14-387Z-builder-3ertwr/acceptance-evidence.md`:
a memory record is recalled with current provenance, updated to superseded,
then retracted through the existing retract provider so later recall omits it.

Validation passed: `pnpm typecheck`, `pnpm lint`, strict-types policy, focused
memory/knowledge/recall/retract tests, cross-client recall conformance test,
web recall-render test, mobile RecallScreen test, and Apple RecallView tests.
The OpenAI and Jason Liu source pages were reachable during implementation;
the Perplexity source was inaccessible through the available browser. It is no
longer needed since the task body already captured the relevant
memory/correction intent and no unread claims from that page were used beyond
that summarized intent.
