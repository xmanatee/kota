# Follow-Up Policy Change

Apply this modification without regressing the original brief:

- Claims with `policyException: true` now require the `compliance-reviewer`
  role. A finance manager alone must return `requires_compliance`; a compliance
  reviewer may approve the valid policy-exception claim.
- Rail travel receives a sustainability credit of `sustainabilityCreditCents`
  before totals are formatted or compared with approval limits.

The original locale formatting, authorization, audit, validation, and dynamic
backend requirements still apply after this change.
