---
status: dropped
---
# Classify native CLI proxy CONNECT 502 failures through shared provider backoff

## Problem

Repair the demonstrated error-classification gap in src/core/workflow/steps/step-executor-retry.ts. The recorded error is: Agent step "review-issue" failed (codex_cli_error): Reconnecting... 2/5 (stream disconnected before completion: URL error: Proxy connection failed: HTTP CONNECT failed with status 502). Recognize this transient transport failure using narrow CLI provenance and propagate it through the existing provider incident, backoff, and health classification mechanisms. Preserve hard rejection of unrelated execution failures and policy denials. Use canonical runs 2026-09-01T20-18-58-775Z-improver-zxg0n9 and 2026-09-03T19-51-15-931Z-improver-33lhx6 as failure evidence; verify their linkage to the issue's dead letters when permitted evidence becomes available. Keep investigation reconciliation and operational state runtime-owned.

## Desired Outcome

Resolve autonomy issue autonomy-issue-1dc1c29a633c85abd172 at semantic revision 1.

## Constraints

- Preserve the stable issue identity and cited provenance.
- Implement through builder; this proposal is not evidence that the issue is fixed.

## How We Will Know

The recorded CLI error reproduces the current null classification, then classifies as a transient provider failure after repair. A focused production-boundary scenario proves an error result carrying this text and codex_cli_error activates shared provider backoff and retains external-service attribution rather than local-code repair attribution. Unrelated errors and policy denials remain hard failures. Reuse existing owner tests for downstream invariants where sufficient; record the original dead-letter linkage as verified or unavailable without claiming an upstream outage was repaired.

## Context

Issue reviewer disposition:     Canonical state confirms seven observations, empty summaries, and no task or question owner. The linked dead-letter file is inaccessible, but seven canonical improver runs ended immediately before the corresponding observations with the same proxy HTTP CONNECT 502 error, including 2026-09-01T20-18-58-775Z-improver-zxg0n9 and 2026-09-03T19-51-15-931Z-improver-33lhx6. A read-only probe of the current classifyAgentRuntimeFailure returns null for this exact error, including with codex_cli_error provenance, while structured status 502 returns provider/retryable. The production agent executor supplies message and subtype, exposing a current classification gap that bypasses shared provider backoff. Later successful runs do not repair that gap. Active tasks and inbox contain no matching owner; the archived investigation-lifecycle repair addresses a different boundary.


Evidence:

- dead-letter: .kota/dead-letter-queue/items.json#dlq-11b18535-2176-4447-9689-56c1cfd2e13c
- dead-letter: .kota/dead-letter-queue/items.json#dlq-1a1c76aa-2c25-45ce-ac17-969c9774eb7d
- dead-letter: .kota/dead-letter-queue/items.json#dlq-52fb81b7-ec93-4992-86b3-d38bc7e0aae3
- dead-letter: .kota/dead-letter-queue/items.json#dlq-5a78c326-e00d-49ec-9404-f5f53f16ae31
- dead-letter: .kota/dead-letter-queue/items.json#dlq-b73d01be-aeef-4926-b020-6778a3dab4a3
- dead-letter: .kota/dead-letter-queue/items.json#dlq-c05a3016-396a-48d4-8d15-d6d5e535d128
- dead-letter: .kota/dead-letter-queue/items.json#dlq-fd6170a4-8744-466f-a272-24f28a6eed24
