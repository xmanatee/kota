---
status: done
---
# Validate automation changes with the selected project's tooling

## Problem

At `ab2889452`, Builder replaces `taskQueueIntegrationPolicy`'s installed
task validator with `pnpm check:fast` in `builder/workflow.ts`. The shared
`validateRunIntegration` executes that command in the writer checkout. An
otherwise supported Python or Rust repository cannot publish through Builder
without copying KOTA's package scripts. This is product coupling, not a reason
to implement another execution engine or weaken isolation.

## Outcome

Keep task-data validation and task ownership mandatory at the existing task
publication owner. Resolve project verification from the selected scope's
existing configuration/authoring surface and run it through the shared
integration validator. Trace other writer consumers before changing this
contract: generic repository publication must not depend on KOTA self-development
conventions. Keep KOTA's own checks configured for KOTA, not embedded in Builder.

Use existing trusted-scope command authority and reconciliation semantics.
Missing project configuration must produce a clear setup outcome; never silently
skip declared checks or execute a repository-supplied command with host authority.
Keep harness-specific behavior inside its adapter. Do not add a runner, protocol
DSL, project-name switch, or compatibility fallback.

## Acceptance

Use the existing composition seam to show two Git-root projects with different
tooling can publish valid task changes without importing KOTA package scripts.
Invalid task data and a failed project check both prevent publication; validation
still runs against the reconciled head and repair uses the existing continuation.
Retain claims, critic review, scope isolation, and failure visibility. Update
the affected owner tests, replacing command-literal assertions with these effects.
No all-harness benchmark, extra full matrix, or new sandbox implementation is
needed for this deterministic contract. Keep the deliberate Git-root restriction.

## Completion

Builder now composes mandatory installed task validation with the selected
canonical scope's trusted project command. KOTA configures its own static check;
Explorer retains its separate watchlist check. Shared reconciliation, ownership,
critic review and integration repair remain in their existing owners.

Verified with the two-project publication and rejection journey, the composed
external-scope onboarding journey, selected owner and reconciliation tests,
static checks and production compilation. Test OS ports were controlled where
the run sandbox denied process observation or nested sandbox execution; this
does not claim live OS sandbox enforcement. Run evidence records the exact
checks and environment limitations.

The subsequent host check found that newly tracking `.kota/config.json`
overwrote ignored operator settings during Git publication. The monitor removed
that tracking exception, retained the validation command in local configuration,
and restored the recorded model, concurrency, Telegram allowlist/autonomy and
browser settings. Shared integration now disables Git's ignored-file overwrite;
its existing owner suite verifies both trees and the integration lock remain
safe when an incoming tracked path collides with private canonical content.
