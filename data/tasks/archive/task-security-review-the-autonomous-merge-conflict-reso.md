---
status: done
---

# Security review: The autonomous merge-conflict resolver and its semantic reviewer concatenate branch-controlled task text, conflict metadata, diffs, validation output, and resolver output directly into agent prompts without injection screening or an untrusted-content envelope. A prompt injection can therefore influence both the generated resolution and its reviewer before the merge gate commits and fast-forwards the result into the canonical checkout.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/autonomy/workflows/builder/merge-conflict-resolver.ts
claim:

> The autonomous merge-conflict resolver and its semantic reviewer concatenate branch-controlled task text, conflict metadata, diffs, validation output, and resolver output directly into agent prompts without injection screening or an untrusted-content envelope. A prompt injection can therefore influence both the generated resolution and its reviewer before the merge gate commits and fast-forwards the result into the canonical checkout.

## Desired Outcome

> Treat the task contract, paths, diffs, validation streams, and resolver output as untrusted data. Render them through the established escaped untrusted-content format with detectInjection metadata, bind the task contract to a trusted claim or canonical revision instead of the mutable worktree copy, and make the independent reviewer fail closed on suspicious prompt content. Add focused tests covering hostile task text, filenames, diff lines, validation output, resolver summaries, and embedded closing markers.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-23T03-21-51-060Z-security-review-uvm0x8.

finding id: merge-conflict-resolver-unscreened-prompt-content
candidate id: tool-execution:src/modules/autonomy/workflows/builder/merge-conflict-resolver.ts:62
verdict: confirmed
rationale:

> The resolver directly interpolates the mutable worktree task, conflict metadata, canonical diff, and validation streams into its prompt. Its reviewer similarly receives raw task content, diffs, and resolver output. Neither path screens or escapes these inputs as untrusted content. File-scope guards and validation constrain mutations but cannot prevent semantic manipulation; an approved resolution is committed and fast-forwarded into the canonical checkout.

Evidence:

Evidence 1:

path: src/modules/autonomy/workflows/builder/merge-conflict-resolver.ts

line: 72

excerpt:

> const task = showTask(request.workspaceDir, request.taskId);

Evidence 2:

path: src/modules/autonomy/workflows/builder/merge-conflict-resolver.ts

line: 102

excerpt:

> prompt: mergeConflictResolverPrompt(request, task),

Evidence 3:

path: src/modules/autonomy/workflows/builder/merge-conflict-resolver-support.ts

line: 143

excerpt:

> "#\# Claimed Task Contract",
> task.content.trim(),
> ...
> "#\# Canonical Diff For Conflict Files",
> request.canonicalDiff,
> ...
> formatValidation(request.previousValidation),

Evidence 4:

path: src/modules/autonomy/workflows/builder/merge-conflict-resolution-review.ts

line: 105

excerpt:

> "#\# Claimed Task Contract",
> task.content.trim(),
> ...
> "#\# Resolver Summary",
> resolutionSummary,
> ...
> "#\# Actual Resolved Diff",
> resolvedDiff,

Evidence 5:

path: src/modules/git/worktree-merge-gate.ts

line: 127

excerpt:

> if (!validation || validation.passed) {
>  stageConflictPaths(input.workspaceDir, conflicts);
> ...
>  const commit = commitResolvedMerge(input.workspaceDir, input.branch);
> ...
>  return validateAndFastForwardCanonical(selector, {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Focused verification passed: `pnpm test src/core/workflow/steps/step-executor-agent-prompt.test.ts src/core/workflow/repair-loop.test.ts src/modules/autonomy/workflows/builder/merge-conflict-prompt-content.test.ts src/modules/autonomy/workflows/builder/merge-conflict-resolver.test.ts src/modules/autonomy/workflows/builder/merge-conflict-resolver-native.test.ts src/modules/autonomy/workflows/builder/merge-conflict-resolver-native-review.test.ts` (6 files, 30 tests).
- Affected-suite verification passed: `pnpm test src/strict-types-policy.integration.test.ts src/modules/git src/modules/autonomy/workflows/builder` (55 files, 354 tests); `pnpm typecheck` also passed.
