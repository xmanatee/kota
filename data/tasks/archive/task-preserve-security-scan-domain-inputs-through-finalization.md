---
status: done
---
# Preserve security scan domain inputs through finalization and recovery

## Problem

The finding-artifact correction in `537eda4ae` restored ordinary dispatcher
routing, but left candidate packets as diagnostic step output. On September 11,
run `2026-09-11T10-41-56-480Z-security-review-t5si5n` finished its agent work and
failed finalization at `reviewed.<path>.surfaces`. It remains `needs_attention`
and owns `scope:8nrg1m:autonomy:security-review`, correctly preventing another
review from silently replacing the unfinished one.

The retained `security-review-candidates.json` has valid `secret-handling`
surfaces. Its projected `steps/scan-candidates.json` changes nine such surfaces
to `[redacted]`; four content digests keyed by secret/token-related source paths
are redacted too. `finalizeSecurityReview` reads that packet through
`scanCandidates.outputRequired`, then combines its surfaces with authoritative
review state. Strict state validation rejects the result. This is diagnostic
projection being reused as domain input, not bad model reasoning or a provider
refusal. Canonical review state remains valid because finalization is atomic.

## Outcome and approach

Finish the existing artifact/reference boundary for candidate identity, selected
surfaces and pinned content digests. Reuse `securityReviewArtifact` and the
existing refreshed-input artifacts, with one decoded authoritative packet for
execution, dependent steps, finalization and retry. Keep bounded agent-facing
diagnostics separate. Trace all consumers in `candidate-steps.ts`,
`finding-steps.ts` and `refusal-steps.ts`; do not fix only the enum symptom.

Do not weaken state validation, disable secret scrubbing, guess masked values,
add a parallel result store, or duplicate the security-family task's publication
and cohort work. The previous dispatcher task was retired; this task owns the
remaining candidate-input defect, not a repeat of its completed repair.

## Acceptance

- Through production persistence/finalization, a scan with `secret-handling`
  candidates and secret/token-related path keys retains exact domain identities
  and digests while diagnostic exports still redact sensitive content.
- Ordinary completion, provider-refusal handling and persisted retry use the
  same authoritative inputs; invalid or changed artifacts fail visibly without
  publishing coverage. Extend the existing owner-level verification rather than
  duplicating a workflow test matrix.
- Make retained-run recovery work through the existing finalization owner.
  Preserve completed investigation and independent revalidation; reuse original
  source artifacts only when provenance and pinned content verify. Unverifiable
  old results remain retained without claiming coverage; they do not prevent
  publishing the correction. Do not rerun successful agent work merely to replace
  masked diagnostics.
- Verify persistence, finalization and failure rejection through the real owners
  with representative artifacts. The live retained review's finalization and
  resource release occur after this correction activates and are operational
  follow-up, not an impossible prerequisite for publishing this builder's code.
  Report actual recovery separately from a local replay; never claim unperformed
  live checks passed. Ordinary builder routing must remain available.

## Completion

Candidate scans persist a decoded artifact bound to the refreshed Git-input
reference. Dependent steps, ordinary finalization, refusal finalization and retry
reload that authoritative packet. Agent summaries remain scrubbed diagnostics.
The boundary rejects changed bytes, malformed identities/surfaces/counts,
candidates outside pinned input and substituted refreshed-input references.

Retained pre-reference scans recover through the existing runtime finalizer only
when the original run path, complete diagnostic projection and hash-pinned input
agree with the source candidates. Investigation and independent revalidation keep
their integrity and consistency checks. Unverifiable inputs fail atomically,
without publishing coverage or rerunning successful agents. A local persisted
legacy replay exercises this path with the original read-only repository contract
under today's workflow definition, including source, input, projection,
provenance and missing-revalidation rejection. It is not a live recovery.

Verification: 50 persistence, refusal and dispatcher owner tests passed, covering
exact secret-handling identities and token-path digests, current-head retry,
atomic rejection, legacy finalization replay and ordinary routing. The security
workflow suite passed 42 of 43 tests. The remaining case passes its scan/finding
identity, diagnostic-redaction and production-finalization assertions, then fails
publication process startup because this worker denies `/bin/ps` (EPERM).
Shared lifecycle/coordinator evidence from this run also records 42 passing tests.
The static gate (`pnpm check:fast`) passed. Production TypeScript emission passed
with an isolated output directory under the run. The standard `pnpm build` could
not remove existing `dist` directories (EPERM), so full packaging was not verified
in this completion attempt. Results are retained in the run's completion logs.
No model or prompt judgment changed; this correction replaces diagnostic inputs
with verified domain inputs, as demonstrated by the persistence outcomes.

Live finalization and resource release remain post-activation operational follow-up.
The earlier runtime-provided issue export records the original review retained
with completed investigation and revalidation. Direct collection of its four source
artifacts was denied in this worker; that does not establish host capability or
credential absence. No live run, daemon, resource, agent result or other task
contract was changed. Unverifiable old evidence remains retained and does not
prevent publication of this correction.
