---
id: task-explorer-task-depth-signal
title: Add task depth and recency signals to explorer prompt to improve portfolio quality
status: dropped
priority: p3
area: runtime
summary: The explorer prompt lacks explicit signals about how many tasks of each area/shape are already open, causing it to add repetitive or shallow tasks instead of identifying genuine capability gaps.
created_at: 2026-04-01T05:41:53Z
updated_at: 2026-04-01T08:33:31Z
---

## Problem

The explorer identifies and manages tasks, but its prompt does not have a structured view of the existing portfolio's composition — how many tasks are in each area, what shapes dominate (cli vs runtime vs operator-ux), or how recently each type of task was completed. Without this, the explorer tends to recycle familiar shapes and misses architectural or reliability gaps that are less obvious.

The existing guidance in `tasks/AGENTS.md` covers this at a high level ("keep some real range"), but the explorer agent sees only a flat task list and must infer balance itself.

## Desired Outcome

The explorer workflow pre-step collects a compact portfolio summary (area × count × recency) and injects it into the explorer prompt as a structured signal. The explorer uses this to prefer underrepresented areas and avoid adding tasks in categories already saturated.

The summary should include: area distribution in ready + backlog, the last completion timestamp per area (from done/), and a short list of recently completed task shapes.

## Constraints

- Do not over-engineer the signal — a short structured table or JSON object injected into the prompt is sufficient.
- The pre-step must be a code step, not an agent step, to keep it fast and deterministic.
- Do not change the task format or file structure; derive the signal from existing task frontmatter.
- The prompt injection should follow the existing `exposeOutputToAgent: true` pattern already used in the builder and improver workflows.

## Done When

- The explorer workflow has a code pre-step that computes area distribution and recency signals.
- The computed signal is injected into the explorer agent's prompt via `exposeOutputToAgent: true`.
- The explorer prompt references the injected signal and uses it to guide task selection.
- Unit test covers the pre-step computation with a fixture task set.

## Why Dropped

The proposed approach (pre-computing a portfolio summary and injecting it via `exposeOutputToAgent: true`) directly conflicts with KOTA's engineering rule: "Prefer clear discoverable surfaces over injected context summaries. If an agent can gather context itself, do not precompute and force-feed it." The explorer can already read all task files directly. The current explorer prompt has comprehensive task diversity guidance, and the observed queue is healthy with good range. The right response to explorer repetitiveness (if it recurs) is clearer prompt guidance, not pre-computed injection.
