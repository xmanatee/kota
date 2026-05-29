---
id: task-add-a-codebase-investigation-answer-scenario-to-ha
title: Add a codebase-investigation answer scenario to harness parity
status: ready
priority: p2
area: modules
summary: Add a no-production-edit harness-parity scenario where the agent investigates a small codebase question, records cited runtime-backed findings in an answer artifact, and passes deterministic verification without changing source code.
created_at: 2026-05-29T13:16:13.655Z
updated_at: 2026-05-29T13:16:13.655Z
---

## Problem

KOTA's harness-parity pack is strong on code-editing surfaces: smoke,
multi-file implementation, failure-and-revise, project discovery,
cross-file rename, frontend preview, and staged package upgrades. Recent
work also added trajectory and context-retrieval diagnostics, so operators
can see whether a harness reached task-relevant files before editing.

It still does not isolate a common professional coding-agent job where the
right output is not a patch: investigating a codebase question and producing
a precise, cited answer backed by runtime evidence. In current parity
scenarios, an agent can only succeed by changing code. That leaves a gap for
harnesses that can explore and reason correctly but need to prove answer
completeness, citation discipline, and "no production edit" restraint.

SWE Atlas makes this gap concrete through its Codebase Q&A track: agents are
asked architecture, root-cause, onboarding, security, and API-integration
questions inside real repositories. Scale's writeup notes that strong answers
require investigating the system in motion, not only reading source. KOTA
should not import SWE Atlas, Harbor, Modal, or an LLM judge, but the parity
pack should carry one compact local scenario that measures the answer-shaped
workflow directly.

## Desired Outcome

Add a harness-parity scenario where the agent investigates a small local
codebase question and writes a machine-checkable answer artifact, without
changing production source.

The scenario should be self-contained and deterministic:

- The initial tree contains a small project with enough source, tests, and
  runtime behavior to make source-only inspection incomplete.
- The prompt asks a concrete codebase question, such as explaining why a
  specific input path behaves unexpectedly or how two modules interact.
- The agent must run or inspect a local command that produces evidence needed
  for the answer.
- The expected output is an `answer.json` or similarly structured artifact
  with concise findings, cited source paths, and cited runtime evidence.
- The verifier rejects missing findings, missing citations, stale source-only
  guesses, production/source edits, and broad unrelated file changes.
- The scenario emits normal harness-parity artifacts, including trajectory,
  trajectory diagnostics, optional context-retrieval diagnostics, diff,
  verification, run metadata, and top-level `parity.json` summary.

## Constraints

- Keep this inside `src/modules/harness-parity/`; do not add an eval-harness
  fixture, second runner, benchmark import, scoring database, or LLM judge.
- Reuse the existing scenario schema and runner patterns. Extend the schema
  only if an answer-artifact contract cannot be expressed cleanly with the
  current verifier path.
- Keep verification deterministic through a local command. It may inspect
  `answer.json`, command transcripts, citations, and changed paths, but it
  must not call a model or external service.
- The scenario must be "answer only": production source, test files, and
  verifier files are not valid edit targets.
- Keep the project tiny enough for operator-run parity captures. The goal is
  to isolate codebase-investigation answer quality, not to reproduce SWE
  Atlas.
- If the durable artifact or scenario coverage contract changes, update
  `src/modules/harness-parity/AGENTS.md` at the conventions level.

## Done When

- A new scenario directory exists under
  `src/modules/harness-parity/scenarios/<id>/` with `scenario.json`, an
  `initial/` tree, and a deterministic verifier for the answer artifact.
- `pnpm kota harness-parity list` surfaces the scenario.
- The prompt asks for an answer artifact with cited source paths and runtime
  evidence, and it does not enumerate every file the agent must inspect.
- The verifier passes only when the answer includes the required findings,
  source citations, runtime evidence citation, and no production/source/test
  edits.
- Focused tests cover scenario loading, the initial tree failing before an
  answer is written, a source-only or uncited answer failing, a valid
  runtime-backed answer passing, and source edits causing failure.
- If `contextRetrieval` metadata is useful for this scenario, the target paths
  are declared so the existing retrieval diagnostics report whether the agent
  reached relevant files before writing the answer.
- The harness-parity `AGENTS.md` scenario coverage list includes the new
  codebase-investigation answer dimension if the implementation changes that
  durable coverage claim.

## Source / Intent

Explorer run `2026-05-29T13-14-27-948Z-explorer-nbwg2p` reviewed an empty
actionable queue. The strategic blocked alternatives were all legitimate
operator-capture waits and not movable, so the queue needed one strategic
module-first task rather than client fan-out or another blocked item.

External sources checked:

- `https://github.com/scaleapi/SWE-Atlas` is now accessible and describes
  SWE Atlas as open-source data and instructions for Codebase QnA, Test
  Writing, and Refactoring. The repository depends on Harbor and Modal for
  benchmark runs, which KOTA should not import.
- `https://labs.scale.com/papers/sweatlas` summarizes SWE Atlas as 284 tasks
  across Codebase QA, Test Writing, and Refactoring, with category-specific
  evaluation and both programmatic and rubric-based assessment.
- `https://scale.com/blog/swe-atlas-complete` highlights that Codebase Q&A
  requires architecture, root-cause, onboarding, security, and API/library
  integration investigation, and that strong agents use runtime evidence
  rather than source-only reasoning.

Local overlap check:

- `task-add-a-targeted-test-writing-fixture-to-the-eval-ha` already covers
  SWE Atlas Test Writing through a compact eval-harness fixture with
  mutation-style checks.
- `rename-across-files`, `package-upgrade-chain`, and the completed
  cross-file refactor scenario already cover the refactoring side of SWE
  Atlas at the harness-parity layer.
- Context-retrieval diagnostics show whether an agent reached task-relevant
  files, but they do not verify answer completeness, cited evidence, or
  no-edit restraint for an answer-shaped codebase investigation.

## Initiative

Harness-parity evidence quality: KOTA should compare coding harnesses not
only by patch outcomes, but by whether they can investigate a codebase and
produce cited, runtime-backed answers without unnecessary edits.

## Acceptance Evidence

- Diff showing the new harness-parity scenario directory, verifier, and any
  schema or `AGENTS.md` coverage update.
- Focused test transcript for the scenario loader and verifier cases.
- `pnpm kota harness-parity list` transcript showing the new scenario.
- Sample harness-parity artifact under `.kota/runs/<run-id>/` or a committed
  test fixture showing the answer artifact, verification result, trajectory
  diagnostics, and `parity.json` summary for the new scenario.
