---
id: task-align-verification-ownership-and-cadences
title: Align verification ownership and validation cadences
status: backlog
priority: p1
area: autonomy-quality
summary: Establish the current baseline, one behavior-ownership standard, truthful validation portfolios, and automation guidance that asks for proportionate proof.
task_class: Meta
depends_on: [task-make-task-authoring-atomic-and-complete]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-27T00:45:00.000Z
---
## Problem

Repository standards, scoped instructions, package scripts, Vitest projects, and autonomy prompts still express competing verification incentives. They can reward missing-test speculation, literal catalogs, per-layer assertions, source-absence checks, artifact counts, or broad default execution instead of selecting the strongest proof for a distinct consumer-visible failure.

## Scope / Starting Points

- `docs/STANDARDS.md`, `docs/ARCHITECTURE.md`, root and scoped `AGENTS.md` files
- package scripts, Vitest projects, client validation commands, and release checks
- builder, critic, PR reviewer, decomposer, progress reviewer, security reviewer, improver, and task-generation prompts under `src/modules/autonomy/workflows`
- every executable test family and authored fixture/support file, including files over 500 LOC

## Required Changes

- Define one admission model: consumer, production owner, public stimulus, observable oracle, distinct failure, and cadence.
- Treat types, schemas, generators, registries, static inspection, runtime probes, behavior checks, protocol checks, resilience checks, journeys, and evals as alternative proof mechanisms.
- Remove instructions that mechanically demand tests, coverage, artifacts, source scans, or preserved implementations; retain judgment and explicit risk.
- Make owner, protocol, resilience, integration, eval, CLI, and broad/release commands select real, documented, non-overlapping portfolios.
- Freeze a temporary inclusive baseline with one reproducible counting recipe. Classify every test family and every test/support file over 500 LOC by production owner, cadence, and `KEEP`, `CONSOLIDATE`, `REPLACE`, or `DELETE` disposition.

## Counting Contract

Separately report executable test LOC, authored test-support/fixture LOC, generated or vendored exclusions, and production glue implicated by duplicated verification. Renaming or moving code does not count as reduction. Record the exact command and exclusions in the program anchor and reuse them unchanged by the final audit unless a correction is explained.

## Must Not Complete While

- Any named instruction or command surface still contradicts the ownership model.
- A documented cadence name does not map to a real portfolio.
- Any large family or file over 500 LOC lacks an owner and disposition.
- A permanent LOC, coverage, test-count, artifact-presence, or source-scan gate has been added.

## Done When

- The baseline and exhaustive disposition manifest are attached to the initiative.
- Fast default, owner, protocol, resilience, integration, eval, CLI, and release portfolios have explicit membership and no accidental exhaustive overlap.
- All named automation prompts describe outcomes and risk without requiring test filenames or assertion categories.
- Review guidance explicitly permits no new test when an architectural mechanism already proves the behavior.

## Acceptance Evidence

Provide the baseline command and output, portfolio membership diff, disposition manifest, and instruction/prompt diff grouped by removed bias.

## Source / Intent

Derived from the repository-wide testing concentration investigation and the requirement to prevent self-improving automation from recreating it.

## Initiative

This is the shared verification contract for the lean behavioral verification program.
