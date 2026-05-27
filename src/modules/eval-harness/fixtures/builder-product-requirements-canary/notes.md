# Builder Product Requirements Canary

This replay-backed builder fixture seeds a tiny reimbursement workflow with a
product brief and a follow-up policy request. The seeded implementation writes
a plausible placeholder artifact but does not implement the backend policy
logic.

The scorer invokes `src/reimbursement-service.mjs` several times and writes
`requirements-result.json` with one canary result per product requirement:
locale and currency formatting, role-specific authorization, audit-history
preservation, validation, follow-up policy-exception handling, dynamic holdout
behavior, and a regression guard that proves the original requirements still
hold after the follow-up change.

`node scripts/check-requirements.mjs --self-test-shortcuts` exercises the
shortcut guards without mutating the fixture project. It proves prose-only UI
artifacts, hardcoded sample-only results, and follow-up regressions are rejected
by the same validation logic used by the main scorer.
