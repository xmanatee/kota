---
status: done
---

# Security review: The new health-review projection only treats dead-letter and module-log refs as runtime-derived, so other runtime text copied into run/artifact evidence summaries, such as error.txt, daemon log, or inbox warning lines, can still be persisted into autonomy-health-review.json and re-exposed to the improver agent through health issue cards.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/health-review-evidence-policy.ts
claim:

> The new health-review projection only treats dead-letter and module-log refs as runtime-derived, so other runtime text copied into run/artifact evidence summaries, such as error.txt, daemon log, or inbox warning lines, can still be persisted into autonomy-health-review.json and re-exposed to the improver agent through health issue cards.

## Desired Outcome

> Extend the health-review projection to omit or bounded-reference every runtime-text-bearing evidence summary, including run/artifact refs sourced from error.txt, daemon logs, and inbox warnings, or classify these refs at source with a data class the projection can enforce. Add regression coverage proving prompt-like text from those sources is absent from autonomy-health-review.json and improver-exposed health issue cards while preserving refs and counts.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-01T08-44-24-640Z-security-review-gfb0ws.

finding id: health-review-runtime-artifact-summary-projection-gap
candidate id: secret-handling:src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts:526
verdict: confirmed
rationale:

> Confirmed. src/modules/autonomy/health-review-evidence-policy.ts:4-7 only classifies dead-letter and module-log as runtime-derived, and nonmatching refs keep summary text after redactSensitiveText at lines 27-33. Runtime producers create run/artifact refs with runtime text: error.txt is read and copied into run/artifact summaries in src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-runs.ts:32-35 and 59-73, and daemon/inbox evidence lines are copied into artifact summaries in src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-evidence.ts:40-53 and 58-72. The persistence path writes the projected review artifact at src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts:844-851, and improver-exposed cards re-project the same refs at src/modules/autonomy/health-issue-cards.ts:135-151 before exposeOutputToAgent at src/modules/autonomy/workflows/improver/workflow.ts:90-103. Because run and artifact are not runtime-derived in the policy, prompt-like runtime summaries from those sources can remain in autonomy-health-review.json and the improver input.

Evidence:

Evidence 1:

path: src/modules/autonomy/health-review-evidence-policy.ts

line: 4

excerpt:

> const RUNTIME_DERIVED_EVIDENCE_KINDS = new Set<AutonomyHealthEvidenceRef["kind"]>([

Evidence 2:

path: src/modules/autonomy/health-review-evidence-policy.ts

line: 21

excerpt:

> if (RUNTIME_DERIVED_EVIDENCE_KINDS.has(ref.kind)) {

Evidence 3:

path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-runs.ts

line: 32

excerpt:

> const errorPath = join(ctx.projectDir, ".kota", "runs", run.id, "error.txt");

Evidence 4:

path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-runs.ts

line: 70

excerpt:

> kind: "artifact",

Evidence 5:

path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-runs.ts

line: 72

excerpt:

> summary: observation.errorSummary,

Evidence 6:

path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-evidence.ts

line: 50

excerpt:

> kind: "artifact",

Evidence 7:

path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-evidence.ts

line: 52

excerpt:

> summary: truncateSingleLine(text),

Evidence 8:

path: src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts

line: 850

excerpt:

> const projected = projectAutonomyHealthReviewArtifactForPersistence(artifact);

Evidence 9:

path: src/modules/autonomy/health-issue-cards.ts

line: 143

excerpt:

> summaries: projectAutonomyHealthSummariesForReview(

Evidence 10:

path: src/modules/autonomy/workflows/improver/workflow.ts

line: 93

excerpt:

> exposeOutputToAgent: true,

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.test.ts src/modules/autonomy/health-issue-cards.test.ts` passed with 2 test files and 12 tests.
- `pnpm typecheck` passed.
- `pnpm validate-tasks` passed.
- Run artifacts: `.kota/runs/2026-07-01T12-38-34-981Z-builder-lae3nm/success-criteria.txt`, `.kota/runs/2026-07-01T12-38-34-981Z-builder-lae3nm/success-criteria-verified.txt`, and `.kota/runs/2026-07-01T12-38-34-981Z-builder-lae3nm/validation-results.txt`.
