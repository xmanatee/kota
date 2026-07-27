---
id: task-complete-revalidation-of-the-timed-out-security-re
title: Complete revalidation of the timed-out security-review findings
status: blocked
priority: p1
area: security
task_class: Safety
summary: Preserve the investigation artifact from security-review run 2026-07-27T09-34-53-266Z-security-review-lgkie5, revalidate all three high-severity candidate findings, create canonical Safety tasks for every confirmed finding, and disposition dlq-494c3024-cca4-49e9-8376-0398d172932c. Harden the revalidation path only if a same-shape run reproduces the timeout.
created_at: 2026-07-27T10:27:02.232Z
updated_at: 2026-07-27T11:07:09.380Z
---

## Problem

    Preserve the investigation artifact from security-review run 2026-07-27T09-34-53-266Z-security-review-lgkie5, revalidate all three high-severity candidate findings, create canonical Safety tasks for every confirmed finding, and disposition dlq-494c3024-cca4-49e9-8376-0398d172932c. Harden the revalidation path only if a same-shape run reproduces the timeout.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-27T10-25-07-113Z-progress-reviewer-2tmw68.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-27T10-25-07-113Z-progress-reviewer-2tmw68.

review verdict: needs-steering
review summary:

    The window is Safety-heavy: Safety 7, Platform 1, Meta 2, Product 0. Two secret-isolation fixes landed, while the multi-project secrets fix remains pending an existing owner decision. A security-review timeout also left three high-severity candidate findings unevaluated and one dead letter open.

Evidence ids:

- run:2026-07-27T09-34-53-266Z-security-review-lgkie5
- dead-letter:dlq-494c3024-cca4-49e9-8376-0398d172932c

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- The source investigation is preserved byte-for-byte at `.kota/runs/2026-07-27T09-34-52-952Z-builder-o7ar1e/security-review-investigation.json` (SHA-256 `1e440b24d48d645c8dbcdcfbb17d634dac670d514cbd59f60a6c4d4092e77b77`).
- `.kota/runs/2026-07-27T09-34-52-952Z-builder-o7ar1e/security-review-revalidation.json` records builder current-code dispositions and isolated boundary-probe rationales for all three source findings. These dispositions support the follow-up tasks but are not represented as the timed-out evaluator step's output.
- `.kota/runs/2026-07-27T09-34-52-952Z-builder-o7ar1e/same-shape-revalidation-runner.ts` invokes the validated `revalidate-findings` definition through the production workflow step executor, including the Codex harness, prompt, four-turn structured-output contract, and 1,800,000 ms active-timeout rail. Its paired evidence and input-hash artifacts show that the authenticated live attempt reached the provider boundary but disconnected after 35,929 ms without structured output. `withinTimeout` and `timeoutReproduced` therefore remain `null`; the earlier 4 ms boundary probes are not same-shape evidence.
- Canonical P1 Safety tasks `task-security-review-the-gemini-and-vercel-kota-hosted-`, `task-security-review-each-project-owns-a-distinct-appro`, and `task-security-review-the-default-daemon-state-directory` preserve the confirmed claims and cited evidence.
- Dead-letter `dlq-494c3024-cca4-49e9-8376-0398d172932c` remains open: the dismissal command reached the canonical CLI, but the daemon control endpoint was unreachable from this sandbox and the local fallback could not write the canonical DLQ file (`EPERM`). The durable dismissal rationale and retry command are recorded in `security-review-revalidation-evidence.json`.
- Review-provided acceptance evidence:

    A completed security-review artifact records an evaluator verdict for each of the three investigation findings; every confirmed finding has a canonical Safety task with cited evidence; the dead letter is redriven successfully or dismissed with durable rationale; and a same-shape revalidation completes within 1,800,000 ms or a focused regression demonstrates and fixes the reproduced timeout cause.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/2026-07-27T09-34-52-952Z-builder-o7ar1e/operator-security-revalidation-completion.json
description: network-enabled canonical completion evidence - operator runs same-shape-revalidation-runner.ts with KOTA_REVALIDATION_CODEX_HOME set to a writable authenticated Codex state directory, verifies security-review-revalidation-evidence.json reports outcome completed with three structured verdicts within 1,800,000 ms (or lands a focused timeout fix and regression if it reproduces), runs the recorded dismissal for dlq-494c3024-cca4-49e9-8376-0398d172932c from an environment that can reach the daemon or write its canonical DLQ store, and captures both the passing revalidation fields and dismissed after-state in this JSON file
```

## Blocked Status

The source investigation is preserved byte-for-byte. Current-code inspection and isolated boundary probes confirm all three claims, and all three canonical P1 Safety tasks exist. The actual same-shape replay loaded the validated workflow definition, built the production prompt, selected the Codex harness and capable model, and entered the real structured-output path, but this sandbox's provider stream disconnected after 35,929 ms. It returned no evaluator output, so the original timeout is neither reproduced nor disproven and no timeout-path hardening is claimed.

The canonical DLQ mutation also remains. The authenticated control address is structurally live but unreachable from the builder sandbox; the canonical CLI therefore selected its local client and failed to create `items.json.tmp` with `EPERM`. `security-review-revalidation-evidence.json` preserves the exact dismissal rationale and retry command. Redrive is inappropriate because it would rescan a changed HEAD after the three source findings already received dispositions and follow-up tasks.
