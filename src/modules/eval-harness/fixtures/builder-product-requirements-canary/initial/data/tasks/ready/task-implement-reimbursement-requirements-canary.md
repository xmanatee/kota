---
id: task-implement-reimbursement-requirements-canary
title: Implement the reimbursement requirements canary service
status: ready
priority: p2
area: eval-harness
summary: Complete the local reimbursement review service so product requirements from the brief and follow-up change are preserved through executable canary evidence.
created_at: 2026-05-27T00:00:00.000Z
updated_at: 2026-05-27T00:00:00.000Z
---

## Problem

The fixture contains a rich product brief and follow-up policy change, but
`src/reimbursement-service.mjs` currently writes a placeholder artifact instead
of enforcing the backend reimbursement rules. A plausible static output would
look polished while dropping authorization, audit, validation, and follow-up
requirements.

## Desired Outcome

Implement `src/reimbursement-service.mjs` as a local CLI-backed service that
reads `data/reimbursement-workflow.json`, applies `docs/product-brief.md` and
`docs/follow-up-change.md`, and writes deterministic JSON output for the
scorer.

Use this verification command:

```sh
node scripts/check-requirements.mjs
```

## Constraints

- Keep the project dependency-free; use built-in Node.js APIs.
- Do not edit `scripts/check-requirements.mjs`, the docs, fixture data, package
  scaffolding, or fixture metadata.
- Do not hardcode only the seeded claims. The scorer creates a dynamic holdout
  claim and token to prove backend behavior is data-driven.
- Do not replace the backend with prose, a static UI, or a prewritten
  `requirements-result.json`.
- Do not commit from the agent step; the workflow commit step handles that.

## Done When

- `node scripts/check-requirements.mjs` exits successfully.
- `requirements-result.json` records all required canary ids with observed
  evidence and `canaryScore: 1`.
- Locale/currency formatting uses the policy locale and currency after the rail
  sustainability credit is applied.
- Finance-manager, employee self-approval, and compliance-reviewer behavior
  match the role-specific authorization requirements.
- Audit history preserves the original event and appends the decision event
  with actor, request id, previous status, and next status.
- Validation rejects claims with missing receipts or non-positive amounts.
- The follow-up policy-exception rule is enforced without regressing the
  original requirements.
- `node scripts/check-requirements.mjs --self-test-shortcuts` exits
  successfully, proving shortcut artifacts and follow-up regressions are
  rejected.
- This task has moved from `data/tasks/ready/` to `data/tasks/done/`.

## Acceptance Evidence

- Command output from `node scripts/check-requirements.mjs`.
- The generated `requirements-result.json` artifact.
- Command output from `node scripts/check-requirements.mjs --self-test-shortcuts`.
- The fixture run artifact records the `product_requirements_canary_score`
  objective metric.

## Source / Intent

Eval-harness fixture seed for measuring whether builders preserve product
requirements and iterative modification context through executable artifacts.
The point is not a polished app; it is a compact local system whose business,
security, audit, validation, and follow-up requirements are graded by canaries.

## Initiative

Outcome-grade autonomy evaluation: builder quality should include retaining
rich product intent across implementation and follow-up changes without
trusting self-reported compliance.
