# Security Review DLQ Resolution

Task: `task-resolve-security-review-investigate-candidates-tim`

## Items

- `dlq-1b47a1a4-ce1a-4a7c-9b9e-b6a0e576dc65`
- `dlq-0695fc11-5adf-4eac-be45-115e07361762`

## Diagnostics Preserved

- `dead-letter-before-dismissal-dlq-1b47a1a4.json`
- `dead-letter-before-dismissal-dlq-0695fc11.json`

Both failed runs wrote `security-review-candidates.json` and then timed out in `investigate-candidates`; neither run wrote `security-review-investigation.json` or `security-review-outcome.json`.

## Resolution

Both cited items were dismissed through `pnpm dev workflow dlq dismiss` with item-specific reasons. Redrive was not useful because later security-review runs reached terminal outcomes on newer heads after the timeout/provider-error classifier work, and replaying these stale triggers would duplicate superseded context rather than protect an unreviewed finding.

## Verification

- `pnpm dev workflow dlq list --status open --workflow security-review --json` returned `items: []`.
- `pnpm dev workflow dlq show dlq-1b47a1a4-ce1a-4a7c-9b9e-b6a0e576dc65 --json` returned `status: "dismissed"` and the recorded dismissal reason.
- `pnpm dev workflow dlq show dlq-0695fc11-5adf-4eac-be45-115e07361762 --json` returned `status: "dismissed"` and the recorded dismissal reason.
