---
status: done
---

# Resolve approval descriptor builder diagnostics

## Problem

    Add or document inspectable observability evidence for the approval descriptor-binding changes in approval-execution.ts, route-handlers.ts, route-helpers.ts, and route-registrations.ts. Also resolve or narrowly justify the source-size advisories reported for approval-queue.ts and approval-execution.ts.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-28T22-09-30-091Z-progress-reviewer-vprp9w.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-28T22-09-30-091Z-progress-reviewer-vprp9w.

review verdict: needs-steering
review summary:

    Needs narrow steering. Within the 24-hour kota directory window, security remediation is advancing, the queue remains actionable, and there are no open dead letters or operator-journey risks. The task balance is Safety 10, Meta 4, Product 0, Platform 0. However, the successful approval-descriptor fix left four runtime-sensitive approval files without observability evidence and two source-size advisories, warranting one focused follow-up.

Evidence ids:

- artifact:2026-07-28T10-56-30-662Z-builder-mdzt36:run-summary.json
- task:task-security-review-approval-execution-is-not-bound-to
- git:commit:f4017df14b96

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A follow-up artifact maps each of the four missing files to a structured log, typed event, explicit error result, focused test assertion, or narrow waiver rationale; an observability-obligation recheck against git:commit:f4017df14b96 plus the follow-up diff reports no unresolved missing files. The source-size advisories are reduced below the guideline without weakening security coverage or recorded with narrow rationale, and focused approval-queue tests plus task validation pass.

## Resolution Evidence

- `.kota/runs/2026-07-29T10-20-22-532Z-builder-dszgxd/evidence/artifacts/approval-descriptor-diagnostics.json` preserves the cited evidence ids, replays `git:commit:f4017df14b96`, maps all four missing files to focused assertions, and records `missingFiles: []`.
- Descriptor-bound queue state, approval types, lease cleanup, and MCP preflight now have focused owners. `src/core/daemon/approval-queue.ts` is 284 lines and `src/modules/approval-queue/approval-execution.ts` is 135 lines; every extracted implementation file is below the 300-line guideline.
- Focused approval and observability validation passed with 11 files and 92 tests. Strict type/boundary validation passed with 3 files and 5 tests; TypeScript, Biome, task validation, the staged observability/source-size checks, and the cached diff check also passed.
- The package-manager version-switch shim could not verify pnpm 10.32.1 while registry access was unavailable, so the same repository-local TypeScript, Vitest, Biome, tsx, and Node entrypoints were invoked directly.
