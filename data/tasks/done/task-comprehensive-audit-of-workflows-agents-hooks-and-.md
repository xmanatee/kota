---
id: task-comprehensive-audit-of-workflows-agents-hooks-and-
title: Comprehensive audit of workflows, agents, hooks, and triggers
status: done
priority: p2
area: architecture
summary: Review all autonomy surfaces for correctness, consistency, completeness, and appropriate guardrailing scope
created_at: 2026-04-15T21:22:34.853Z
updated_at: 2026-04-16T00:24:06.558Z
---

## Problem

The autonomy surface has grown organically. No systematic review has checked whether all workflows, agents, hooks, and triggers follow conventions, avoid duplication, and scope their guardrails appropriately. There may be leftovers, redundancies, legacy patterns, or over-guardrailing that constrains agents unnecessarily.

## Desired Outcome

- Every workflow, agent, hook, and trigger is reviewed for: convention compliance, completeness, conciseness, clarity, consistency.
- No leftovers, duplications, redundancies, or legacy patterns remain.
- Guardrails are verified as appropriate: hardcoded actions only where the next step is 100% certain; otherwise, state checks that return control to the agent.
- Agent task scoping is verified as appropriate — neither too broad nor over-constrained.

## Constraints

- This is a review and cleanup task, not a redesign. Fix what is wrong; do not restructure what works.
- Changes should follow existing conventions, not introduce new ones.

## Done When

- All autonomy surfaces have been reviewed and any issues fixed.
- No convention violations, duplications, or inappropriate guardrails remain.
- Review findings are committed as code/config changes, not as a separate report document.
