---
status: done
---
# Give isolated security reviewers usable, scoped investigation handoffs

## Problem

Run `2026-09-12T10-21-59-916Z-security-review-l7r4ez` investigated
`onboarding-completed-transaction-rollback`, then failed revalidation at 11:28
UTC on September 12. The revalidator explicitly reported `Operation not
permitted` reading the canonical `security-review-investigation.json` and
returned no verdicts. `record-revalidation` correctly rejected the missing
verdict. This is an inaccessible input, not a model judgment or an owner block.

`finding-steps.ts` retains a hash-bound domain artifact under
`ctx.workflow.runDirPath`, but exposes only its reference. `prompt.md` tells
the agent to read that protected directory. `describeCandidates` also exposes
the canonical scan artifact path. Native agents use a separate runtime-owned
agent directory and must not read private canonical runtime state.

## Outcome

Keep authoritative artifacts and finalization integrity checks with their
current owner. Materialize the bounded input needed by investigation and
revalidation in the existing agent-readable runtime directory, and expose that
actual path. Use the existing scoped evidence/export and agent-directory owners;
do not create another store, permission exception or handoff protocol. Do not
make agents reconstruct finding identities from scrubbed diagnostic metadata.

Preserve domain identity and lineage while protecting actual credentials and
unrelated runs. Any redaction that makes a finding unverifiable must be explicit,
not a silently altered id. Treat exported content as untrusted review input;
publication still reloads and validates the immutable authoritative originals.
Update the prompt to use the maintained handoff rather than protected run paths.

## Acceptance

- A dependent native reviewer can read its selected candidates and original
  investigation findings without canonical-state access. It returns one verdict
  per original finding; source integrity and complete verdict validation remain.
- Exercise the existing review journey with distinct canonical and agent roots.
  Check actual readable input, not mocked step outputs alone. Include a
  security-related domain id and genuine secret redaction at the owning layer.
- Retry refreshes the exported input from retained authority; missing or corrupt
  source evidence fails visibly. No unrelated history export or blanket access.
- Recover the original failed review through normal runtime controls after the
  fix loads. Preserve its evidence request and pending finding; do not manufacture
  a verdict or mark unchecked coverage consumed. The monitor owns activation,
  not a builder restarting its parent before publication.


## Resolution

Selected candidates and integrity-checked investigation findings now export to
the runtime-owned agent directory. Exposed paths and the reviewer prompt use
those exports. Shared evidence value redaction preserves security terminology
and lineage, marks removed values, and rejects any identity requiring redaction.
Canonical originals remain the authority for complete verdict validation and
finalization. Retryable export steps refresh their input from that authority.

The existing workflow journey reads the actual paths from the agent prompt,
returns verdicts using exported identities, and verifies canonical finalization
even after export tampering. A restricted Node subprocess reads the exported
findings while canonical reads are denied. Focused cases cover retained-source
refresh, missing/corrupt originals, credential redaction, identity rejection,
and exclusion of unrelated run evidence. Runtime retry also checks refreshed
candidate files after a failed attempt. Validation details and environment
limitations are retained in this builder run's summary and logs.

## Post-publication observation

The monitor owns activation and recovery of
`2026-09-12T10-21-59-916Z-security-review-l7r4ez` after this fix integrates and
loads. Use the normal workflow retry/recovery control for that original run;
preserve its evidence request, pending finding and lineage. Require actual
independent verdicts before consuming coverage. This builder has not restarted
its parent, retried the production review, manufactured a verdict, or changed
production coverage. That deployment observation follows this completed
implementation step.
