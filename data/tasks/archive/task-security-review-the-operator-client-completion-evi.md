---
status: done
---

# Security review: The operator-client completion evidence gate can be satisfied by a broad directory reference such as `.kota/runs/`, because move-to-done trusts `hasConcreteRenderedEvidence()` and that helper recursively accepts any proof-looking file under the referenced directory. This can let unrelated run artifacts satisfy a task's concrete evidence requirement.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/repo-tasks/task-rendered-evidence.ts
claim:

> The operator-client completion evidence gate can be satisfied by a broad directory reference such as `.kota/runs/`, because move-to-done trusts `hasConcreteRenderedEvidence()` and that helper recursively accepts any proof-looking file under the referenced directory. This can let unrelated run artifacts satisfy a task's concrete evidence requirement.

## Desired Outcome

> Require concrete rendered evidence references to resolve to a specific proof file or a narrowly scoped run/evidence directory tied to the task. Add regression coverage proving `.kota/runs/`, project-root, and other broad directories with unrelated transcripts do not satisfy done-state evidence.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-07T17-39-20-052Z-security-review-601l6k.

finding id: security-review-rendered-evidence-directory-bypass
candidate id: task-workflow-mutation:src/modules/repo-tasks/repo-tasks-domain.ts:2
verdict: confirmed
rationale:

> The done transition and task-queue validation both rely on hasConcreteRenderedEvidence for operator-facing client/control completion evidence. That helper extracts directory references ending in '/', resolves them only to ensure they remain under the project, and accepts a directory when any descendant up to the scan depth looks like rendered proof. A runtime probe confirmed that an Acceptance Evidence line referencing `.kota/runs/` returns true when the directory contains only an unrelated `.kota/runs/some-other-run/transcript.txt`, with no task/run binding or broad-directory rejection.

Evidence:

Evidence 1:

path: src/modules/repo-tasks/repo-tasks-domain.ts

line: 277

excerpt:

> toState === "done" && requiresRenderedCompletionEvidence(task) && !(projectDir ? hasConcreteRenderedEvidence(task.body, projectDir) : hasConcreteRenderedEvidenceReference(task.body))

Evidence 2:

path: src/modules/repo-tasks/task-rendered-evidence.ts

line: 168

excerpt:

> extractEvidencePathReferences accepts path-like references that end in `/`, so a broad directory reference is treated as evidence input.

Evidence 3:

path: src/modules/repo-tasks/task-rendered-evidence.ts

line: 206

excerpt:

> directoryContainsRenderedProof recursively scans a referenced directory and returns true when any child file looks like rendered proof.

Evidence 4:

path: src/modules/repo-tasks/task-rendered-evidence.ts

line: 253

excerpt:

> hasConcreteRenderedEvidence returns true when any extracted evidence path resolves inside the project and pathContainsRenderedProof succeeds.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Proof transcript under `.kota/runs/2026-07-07T19-37-49-212Z-builder-m5x8mb/evidence/task-security-review-the-operator-client-completion-evi/proof-transcript.txt`.
- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source pnpm exec vitest run src/modules/repo-tasks/task-rendered-evidence.test.ts src/modules/repo-tasks/completion-evidence-gate-scoped-directory.test.ts src/modules/repo-tasks/completion-evidence-gate.test.ts --configLoader runner --silent=true` passed: 3 files, 17 tests.
- `pnpm exec biome check src/modules/repo-tasks/repo-tasks-domain.ts src/modules/repo-tasks/task-queue-validation.ts src/modules/repo-tasks/task-rendered-evidence.ts src/modules/repo-tasks/task-rendered-evidence-paths.ts src/modules/repo-tasks/task-rendered-evidence-artifacts.ts src/modules/repo-tasks/task-rendered-evidence.test.ts src/modules/repo-tasks/completion-evidence-gate.test.ts src/modules/repo-tasks/completion-evidence-gate-scoped-directory.test.ts` passed.
- `pnpm exec tsc --noEmit --pretty false` and `pnpm validate-tasks` passed.
