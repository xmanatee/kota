---
id: task-critic-agent-review-step
title: Add critic agent step to autonomous workflows
status: done
priority: p2
area: autonomy
summary: Introduce a critic agent that performs an unbiased LLM review of agent work output after validations pass, catching completeness gaps, inconsistencies, and unfinished migrations that mechanical checks miss.
created_at: 2026-04-10T12:47:56Z
updated_at: 2026-04-10T12:47:56Z
---

## Problem

Builder, improver, and inbox-sorter workflows rely on tests, lint, and type
checks to validate work. These catch mechanical breakage but miss semantic
issues: incomplete migrations, tasks marked done when they are not, dishonest
or shallow implementations, and inconsistencies between what was asked and what
was delivered. The owner has observed tasks being marked finished while the
actual work is incomplete.

## Desired Outcome

A critic agent step that runs after mechanical validations pass. It receives:
- the original task or instruction (what was asked)
- a summary of what the agent did (diff, commit message, changed files)

It returns a structured verdict:
- **pass**: work is complete and honest
- **fail with critical issues**: execution returns to the original agent for
  cleanup (using the existing repair loop mechanism)
- **pass with warnings**: non-critical observations are noted but the agent
  may terminate without fixing them

The critic must be objective and calibrated — it should catch real gaps
(breakages, incomplete migrations, unfinished changes) without nitpicking
style or minor preferences.

## Constraints

- The existing repair loop already supports returning execution to the agent
  on failure. The critic step should integrate with that mechanism.
- Research how unbiased critic/reviewer agents are implemented in existing
  systems — calibration and avoiding false positives is critical.
- The critic should not duplicate what tests and lint already check.
- Warnings should be surfaced (e.g. in run artifacts or notifications) but
  not block completion.
- Must work across builder, improver, and inbox-sorter workflows.

## Done When

- A critic agent step exists and runs after mechanical checks pass in at
  least the builder workflow.
- Critical issues from the critic trigger the repair loop.
- Warnings are recorded in run artifacts without blocking.
- The critic prompt is calibrated to avoid false positives on minor issues.
