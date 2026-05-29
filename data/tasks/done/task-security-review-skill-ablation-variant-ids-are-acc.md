---
id: task-security-review-skill-ablation-variant-ids-are-acc
title: Security review: Skill-ablation variant ids are accepted as arbitrary strings and then used directly as filesystem path components, so a crafted fixture can escape the eval parent tmpdir and materialize or run a variant in another local path.
status: done
priority: p2
area: security
summary: Skill-ablation variant ids are accepted as arbitrary strings and then used directly as filesystem path components, so a crafted fixture can escape the eval parent tmpdir and materialize or run a variant in another local path.
created_at: 2026-05-29T14:47:34.537Z
updated_at: 2026-05-29T14:59:25.000Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/eval-harness/runner.ts
claim: Skill-ablation variant ids are accepted as arbitrary strings and then used directly as filesystem path components, so a crafted fixture can escape the eval parent tmpdir and materialize or run a variant in another local path.

## Desired Outcome

Reject skill-ablation variant ids containing path separators, absolute path syntax, or dot segments during fixture loading. Use a safe single-component id pattern and also resolve the variant working directory and assert it remains inside parentWorkingDir before materialization.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-29T14-41-22-161Z-security-review-zqlvzp.

finding id: skill-ablation-variant-id-path-traversal
candidate id: task-workflow-mutation:src/modules/eval-harness/runner.ts:1694
verdict: confirmed
rationale: src/modules/eval-harness/fixture.ts:1161 accepts the variant id through parseRequiredString, which only checks for a non-empty string at src/modules/eval-harness/fixture.ts:620-630. The skill-ablation runner then builds each variant workspace with join(parentWorkingDir, variant.id) at src/modules/eval-harness/runner.ts:1694, and materializeFixtureWorkingDirAt creates and populates that path before initFixtureGit and executor execution at src/modules/eval-harness/runner.ts:306-322 and src/modules/eval-harness/runner.ts:1600-1635. Existing safe path checks cover setup sourcePath/targetPath and round inputs, but not variant ids. Dot-segment ids such as ../escape or ../../escape therefore resolve outside the mkdtemp-created parent directory on Node path.join.

Evidence:

- src/modules/eval-harness/fixture.ts:1161 - const id = parseRequiredString(raw, "id", fixtureDir);
- src/modules/eval-harness/runner.ts:1694 - const variantWorkingDir = join(parentWorkingDir, variant.id);
- src/modules/eval-harness/runner.ts:306 - mkdirSync(workingDir, { recursive: true });
- src/modules/eval-harness/runner.ts:307 - cpSync(fixture.initialStateDir, workingDir, { recursive: true });
- src/modules/eval-harness/runner.ts:322 - initFixtureGit(workingDir);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Result

Skill-ablation variant ids now fail fixture loading unless they match a safe
single-component id pattern, and the runner resolves each variant workspace
under the parent tmpdir before materialization.

Verification:

- `NODE_OPTIONS=--conditions=source pnpm exec vitest run src/modules/eval-harness/fixture.test.ts src/modules/eval-harness/runner.test.ts`
- `pnpm typecheck`
- `pnpm exec biome check src/modules/eval-harness/fixture.ts src/modules/eval-harness/fixture.test.ts src/modules/eval-harness/runner.ts src/modules/eval-harness/runner.test.ts`
