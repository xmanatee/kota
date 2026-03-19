---
id: task-keep-workflow-docs-and-validation-aligned
title: Keep workflow docs and validation aligned
status: backlog
priority: p1
area: workflow
summary: Keep prompts, task docs, AGENTS files, and workflow validation mutually consistent as the system evolves.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

Autonomous behavior becomes confusing when prompts, directory guides, and
runtime validation drift apart.

## Desired Outcome

The workflow system should keep one coherent protocol across prompts, docs,
task files, and validation.

## Constraints

- Prefer fewer surfaces with clearer boundaries.
- Avoid duplicate instructions.
- Make drift obvious when it happens.

## Done When

- The main workflow surfaces tell one consistent story.
- The validation layer checks the most important assumptions.
- Future drift is easier to notice and fix.
