---
id: task-attention-digest-warnings-check
title: Include completed-with-warnings runs in attention digest monitoring
status: backlog
priority: p3
area: reliability
summary: The attention digest checks for builder failure streaks and cost pressure but ignores completed-with-warnings runs. A builder run that repeatedly hits the step output size cap, schema mismatch, or other warning conditions should surface in the digest so operators are aware of a recurring issue.
created_at: 2026-04-02T08:20:00Z
updated_at: 2026-04-02T08:20:00Z
---

## Problem

`attention-digest.ts` checks `detectAttentionItems` for builder failure streaks,
budget pressure, and stale doing-queue tasks. It does not check for
`completed-with-warnings` runs.

If builder repeatedly produces runs that complete with warnings (e.g., every run hits
`maxStepOutputBytes` and gets truncated), the operator only discovers this by manually
inspecting the run list. The attention digest, which is the primary async health signal,
stays silent because the runs are technically "not failures."

## Desired Outcome

`detectAttentionItems` adds a check: if N or more of the last M builder runs have
`completed-with-warnings` status, surface an attention item:

```
Repeated warnings: 4 of the last 10 builder runs completed with warnings
```

The thresholds (N and M) should be configurable via env vars with sensible defaults
(e.g., 3 of 10). The attention item should include the most common warning type if
all warnings share the same `type` field.

## Constraints

- Read warning counts from run metadata files in `.kota/runs/` (the `status` and
  `warnings` fields of run summary/metadata); do not add a new persistent counter.
- Only check builder runs, consistent with the existing failure-streak check.
- Do not emit the digest on every run — only increment the existing counter and check
  thresholds on digest cycles (every `DIGEST_EVERY_N_RUNS` invocations).
- Keep the check as a pure function addition inside `attention-digest.ts`; no new
  files needed.

## Done When

- `detectAttentionItems` includes a warnings-frequency check for builder runs.
- The check fires when N of the last M builder runs have `completed-with-warnings`.
- Thresholds are documented as env vars with their defaults.
- Unit test covers the detection logic across varying warning counts.
