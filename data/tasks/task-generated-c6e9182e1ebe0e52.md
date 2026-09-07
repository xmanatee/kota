---
status: open
priority: p1
---
# Classify native CLI proxy CONNECT 502 failures through shared provider backoff

## Problem

Repair the demonstrated classification gap in src/core/workflow/steps/step-executor-retry.ts for codex_cli_error results containing 'Reconnecting... 2/5 (stream disconnected before completion: URL error: Proxy connection failed: HTTP CONNECT failed with status 502)'. Use narrow CLI provenance and the existing provider incident and shared backoff mechanisms. Preserve rejection of unrelated execution failures and policy denials. Retain the existing task identity and canonical run evidence; verify the original dead-letter linkage when permitted evidence is available. Keep operational recovery runtime-owned.

## Desired Outcome

Resolve autonomy issue autonomy-issue-1dc1c29a633c85abd172 at semantic revision 1.

## Constraints

- Preserve the stable issue identity and cited provenance.
- Implement through builder; this proposal is not evidence that the issue is fixed.

## How We Will Know

The recorded error reproduces null classification before repair and provider classification afterward. A focused production-boundary scenario supplies the real error text and codex_cli_error subtype and demonstrates shared provider backoff activation and external-service attribution. Unrelated failures and policy denials remain rejected. Record whether the original dead-letter linkage was verified or remains unavailable; do not claim the upstream outage was repaired.

## Context

Issue reviewer disposition:     Reopen the existing stable task owner task-generated-c6e9182e1ebe0e52. Commit 1bb2e3ba1 dropped it without an implementation change; canonical issue state still links it, and no active task owns this specific defect. Summaries are empty and the seven linked dead-letter records are inaccessible, so exact linkage remains unverified. However, seven canonical improver failures immediately precede the observations with identical proxy CONNECT 502 errors, including runs 2026-09-01T20-18-58-775Z-improver-zxg0n9 and 2026-09-03T19-51-15-931Z-improver-33lhx6. A current read-only classifier probe returns null for the recorded error with codex_cli_error provenance, while structured status 502 returns provider/retryable. The production executor supplies text and subtype, confirming the classification gap remains actionable.


Evidence:

- dead-letter: .kota/dead-letter-queue/items.json#dlq-11b18535-2176-4447-9689-56c1cfd2e13c
- dead-letter: .kota/dead-letter-queue/items.json#dlq-1a1c76aa-2c25-45ce-ac17-969c9774eb7d
- dead-letter: .kota/dead-letter-queue/items.json#dlq-52fb81b7-ec93-4992-86b3-d38bc7e0aae3
- dead-letter: .kota/dead-letter-queue/items.json#dlq-5a78c326-e00d-49ec-9404-f5f53f16ae31
- dead-letter: .kota/dead-letter-queue/items.json#dlq-b73d01be-aeef-4926-b020-6778a3dab4a3
- dead-letter: .kota/dead-letter-queue/items.json#dlq-c05a3016-396a-48d4-8d15-d6d5e535d128
- dead-letter: .kota/dead-letter-queue/items.json#dlq-fd6170a4-8744-466f-a272-24f28a6eed24
