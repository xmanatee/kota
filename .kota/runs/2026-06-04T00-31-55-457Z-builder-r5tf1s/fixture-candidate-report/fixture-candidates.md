# Fixture Candidates

Runs scanned: 4
Viable: 1
Needs review: 0
Rejected: 3

## 2026-04-24T15-11-48-347Z-builder-gnt9c6

- workflow: builder
- status: rejected
- reasons: duplicate-existing-fixture
- task: task-sample-duplicate
- commands: 1
- changed paths: 1
- verifier targets: 4

  - pnpm test src/modules/eval-harness/fixture-candidates.test.ts

## sample-network

- workflow: builder
- status: rejected
- reasons: reproducibility-auth-walled, reproducibility-network-bound, verifier-no-state-signal
- task: task-sample-network
- commands: 2
- changed paths: 1
- verifier targets: 4

  - curl https://example.com/private-report
  - gh auth status

## sample-secret

- workflow: builder
- status: rejected
- reasons: privacy-secret-like-value, safety-destructive-command
- task: task-sample-secret
- commands: 3
- changed paths: 1
- verifier targets: 4

  - API_TOKEN=[REDACTED] pnpm test src/modules/eval-harness/fixture-candidates.test.ts
  - rm -rf .kota/tmp
  - pnpm test src/modules/eval-harness/fixture-candidates.test.ts

## sample-viable

- workflow: builder
- status: viable
- reasons: none
- task: task-sample-viable
- commands: 2
- changed paths: 2
- verifier targets: 5

  - pnpm test src/modules/eval-harness/fixture-candidates.test.ts
  - pnpm typecheck
