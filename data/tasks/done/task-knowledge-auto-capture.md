---
id: task-knowledge-auto-capture
title: Auto-capture structured insights from completed workflow runs into the knowledge store
status: done
priority: p2
area: autonomy
summary: Completed workflow runs produce valuable observations (patterns, errors, decisions) that are lost when the run ends. No mechanism feeds structured run insights back into the knowledge store for future sessions.
created_at: 2026-04-11T21:40:00Z
updated_at: 2026-04-12T01:10:00Z
---

## Problem

When a workflow run completes, its output and artifacts are stored under
`.kota/runs/` but the observations and decisions made during the run are not
captured in a form that future agent sessions can query. The knowledge store
exists and has a CLI, but nothing feeds it automatically. Each new session
starts without the accumulated understanding of prior runs — agents rediscover
the same patterns, repeat the same research, and miss insights from previous
work.

## Desired Outcome

A post-run step or lightweight workflow that extracts structured insights from
completed runs and writes them to the knowledge store. Insights should be
typed (e.g., `pattern`, `decision`, `error-resolution`, `codebase-observation`)
and tagged with the source run ID and workflow name. Future agent sessions can
query the knowledge store to benefit from accumulated project understanding.

## Constraints

- Do not require every workflow to manually emit knowledge entries. The capture
  mechanism should work from run artifacts and output that already exist.
- Keep extracted entries concise and deduplicated. Do not flood the knowledge
  store with low-value repetitions.
- The capture step should be idempotent — re-running it on the same run should
  not create duplicate entries.
- Use the existing knowledge store API. Do not create a parallel storage
  surface.
- Start with the builder and improver workflows, which produce the richest
  run artifacts. Other workflows can opt in later.

## Done When

- A mechanism (post-run step, dedicated workflow, or event subscriber) extracts
  insights from completed builder/improver runs.
- Extracted entries appear in the knowledge store with type, source run ID, and
  workflow tags.
- Re-running extraction on the same run does not create duplicates.
- At least one agent prompt or skill demonstrates querying captured knowledge.
- Unit or integration tests cover the extraction and dedup logic.
