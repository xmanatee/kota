---
id: task-align-verification-ownership-and-cadences
title: Align verification ownership and validation cadences
status: backlog
priority: p1
area: autonomy-quality
summary: Establish one behavior-ownership standard, truthful validation cadences, and automation guidance that asks for proportionate proof instead of reflexively multiplying tests.
task_class: Meta
depends_on: [task-make-task-authoring-atomic-and-complete]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

KOTA's standards, scripts, directory guidance, prompts, reviewer language, task templates, and default suite topology do not yet express one consistent verification model. Some instructions still bias agents toward missing tests, literal protocol catalogs, per-layer assertions, source-absence checks, and broad default execution. Documented protocol and resilience cadences are not fully implemented.

## Desired Outcome

A single repository standard makes every maintained check identify its consumer, production owner, public stimulus, observable oracle, distinct failure, and cadence. Types, schemas, generators, registries, static inspection, runtime probes, focused behavior checks, protocol checks, resilience checks, vertical journeys, and agent evals are treated as alternative proof mechanisms selected by risk.

## Constraints

- Correct misleading incentives in docs, scoped AGENTS files, builder, critic, PR reviewer, decomposer, progress-reviewer, security-review, task generation, and completion language; trust agent judgment instead of adding brittle prose gates.
- Implement owner, protocol, resilience, integration, eval, CLI, and broad or release cadences so documented names select real non-overlapping portfolios.
- Make the fast default proportionate and avoid copying specialized checks into it.
- Do not add permanent LOC, coverage, test-count, artifact-presence, or source-scan gates.
- Freeze an inclusive executable-test and authored-support baseline with a temporary reproducible inventory, then assign every large family and file over 500 LOC to an owner and disposition.

## How We Will Know

- An engineer or automation can credibly choose no new test when an architectural mechanism proves the requirement.
- A proposed test without a distinct consumer-visible failure is rejected or removed by normal review judgment.
- Docs, package scripts, Vitest projects, client suites, and automation prompts agree on the actual cadence model.
- The baseline reconciles mutually exclusive areas and does not treat moved support or fixtures as deletion.
- Future generated tasks describe outcomes and risk, not mandatory test filenames or assertion categories.
