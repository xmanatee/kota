# Reimbursement Review Brief

Build a local reimbursement review service. It only needs a CLI surface, but it
must behave like backend business logic, not a static UI preview.

Input data lives in `data/reimbursement-workflow.json`. The command must read
that file, apply the policy, and write a machine-readable output file.

Required behavior:

- Format approved or reviewable totals with the policy locale and currency.
  The seeded policy uses `de-DE` and `EUR`; the output should use the locale's
  thousands and decimal separators with the currency code.
- Enforce role-specific authorization. A finance manager can approve normal
  valid claims within the manager limit. An employee must never approve their
  own claim.
- Preserve audit history. Existing history entries stay present, and each
  decision appends one audit entry with the actor, request id, previous status,
  and next status.
- Enforce validation rules. Every line item needs a positive integer amount and
  a non-empty receipt id before approval.
- Keep backend behavior data-driven. The scorer will add a new claim with a
  dynamic id and request token; hardcoded sample-only responses must fail.

Run the local check with:

```sh
node scripts/check-requirements.mjs
```
