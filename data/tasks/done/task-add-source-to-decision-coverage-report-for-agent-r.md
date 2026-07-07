---
id: task-add-source-to-decision-coverage-report-for-agent-r
title: Add source to decision coverage report for agent resources
status: done
priority: p2
area: autonomy
task_class: Meta
summary: Summarize watched multi-agent and evaluation resources into KOTA decisions, existing task coverage, and remaining gaps without adding a parallel external-link catalog.
created_at: 2026-06-25T14:51:40.624Z
updated_at: 2026-07-07T06:46:57.363Z
---

## Problem

KOTA has a useful watchlist and many source-driven tasks, but answering the
owner's question "is this resource actually needed, where, for which tasks, and
for which decisions?" is still mostly manual. Agents can search
`data/watchlist.yaml`, done tasks, and local AGENTS files, but there is no
operator-facing coverage report that links a research resource to the local
decision it influenced.

Without that report, KOTA risks either re-reading the same multi-agent and
evaluation papers repeatedly or, worse, creating duplicate tasks because a
source looks new when its useful local lesson was already adopted or rejected.

## Desired Outcome

Add a source-to-decision coverage report for agent-system resources. The report
should read existing KOTA data and show, for recent or selected watchlist
entries:

- source URL or stable reference;
- current local disposition: adopt, partial-adopt, reject, watch, no-op, or
  needs-research;
- decision summary in KOTA terms;
- covered-by done tasks;
- covered-by open tasks;
- local AGENTS/doc sections that encode the decision when available;
- remaining gap, if any; and
- stale or unverified source snapshot warnings.

The report should be useful during research-heavy turns and queue review. It
should answer "what did this resource change in KOTA?" without becoming the
source of truth itself.

## Constraints

- Do not create a parallel external link catalog. `data/watchlist.yaml`, task
  files, and local AGENTS/docs remain the source of truth.
- Do not scrape the web during normal report generation. Use already captured
  watchlist metadata, local notes, and task ids.
- Do not include full abstracts, article bodies, or long quotes.
- Prefer deterministic or explicit mapping markers over fuzzy LLM matching.
- Do not auto-create tasks from every unmapped source. The report can flag gaps;
  queue creation still requires a normalized task decision.
- Respect existing local decisions in `src/modules/autonomy/AGENTS.md`, such as
  rejecting CrewAI/LangGraph workflow DSLs while adopting typed handoffs and
  stream projections where they fit KOTA.

## Done When

- A report builder reads watchlist entries, open tasks, done tasks, and relevant
  local decision markers, then emits source coverage records.
- The operator report or a focused CLI output groups sources by disposition and
  coverage status.
- The report flags at least: source covered by done task, source covered by
  open task, source rejected/no-op by local decision, and source with no local
  mapping.
- Tests use fixture watchlist/task data and verify deterministic output.
- Documentation or local AGENTS guidance explains how future research tasks
  should leave source-to-decision references without duplicating watchlist data.

## Source / Intent

Owner asked on 2026-06-25 to "research more and really investigate how it's
done and how it should be done" and then create clean KOTA tasks only where
resources are actually needed.

Local mapping:

- `docs/STANDARDS.md` says external best practices should be distilled into
  KOTA's own decisions rather than copied as generic doctrine.
- `data/AGENTS.md` and task instructions already require watchlist discipline,
  normalized tasks, and duplicate avoidance.
- `src/modules/autonomy/AGENTS.md` records adopted and rejected external
  patterns for multi-agent runtime design, but the mapping from watchlist source
  to task/decision is not directly reportable.

Research synthesis:

- Anthropic, Cognition, LangChain, OpenAI, Google ADK, AgentLens, SpecBench, and
  METR sources are all useful, but their local value differs. Some support
  existing done work, some justify open tasks, and some should stay as rejected
  or watched patterns rather than implementation work.

## Initiative

Research-to-local-decision traceability.

## Product / Safety Link

Product: keeps the owner-facing research intake from becoming a duplicate task
generator or hidden second backlog. The product outcome is one clear local
disposition per useful source, mapped to existing tasks, docs, or explicit
no-op decisions instead of repeated rereading and queue churn.

## Acceptance Evidence

- Transcript for the source-to-decision coverage report against fixture or
  local data.
- Focused tests proving source coverage grouping, stale-source warnings, and
  duplicate-safe task mapping.
- Sample report section showing at least one adopted source, one source covered
  by an open task, one rejected/no-op source, and one unmapped gap.

## Completion Notes

- Added `kota report sources` for deterministic watchlist-to-task/local-decision
  coverage without web fetching or a parallel source catalog.
- Evidence transcript:
  `.kota/runs/2026-07-07T05-35-23-899Z-builder-0jh48q/source-coverage-transcript.txt`.
- Focused validation: `pnpm test src/modules/autonomy/report/source-decision-coverage.test.ts src/modules/autonomy/report/report-cli.test.ts`,
  `pnpm typecheck`, targeted Biome check, and `pnpm validate-tasks`.
