---
status: done
---

# Make authenticated research collection work through legal runtime boundaries

## Problem

Research retry advertises browser-assisted recovery of blocked sources, but its
repository-writing workflow calls tools declared as external-network destructive
effects. Installing Playwright and configuring a profile does not make that call
legal: scope policy requires confirmation, and the writer effect boundary rejects
shared mutations even if permission is granted. The current admission correction
prevents impossible retries; it does not deliver authenticated source collection.

Live evidence: run `2026-09-15T01-38-55-355Z-research-retry-t8eqlh`,
`.kota/runs/<run-id>/metadata.json` and `steps/collect-sources.json`, failed on
September 15 at 20:40 UTC with approval `8ea90320`. Earlier notification crashes
are separately repaired by `5f8c77975`; do not reopen that fix. No source read was
authorized or completed by these attempts. Preserve the existing source-access
tasks' owner intent and source provenance.

## Outcome

Provide one honest, reusable source-collection path for research consumers.
Trace the browser module, policy/effect owner, workflow tool execution and research
consumer together. Choose the smallest design that preserves their contracts:
either a genuinely read-only isolated reader whose effects justify that declaration,
or collection under the existing non-writer workflow/approval lifecycle with a
durable artifact handed to the repository writer. Do not merely relabel arbitrary
authenticated browsing as read-only or bypass scope policy to unblock a task.

Use the existing browser/network isolation, artifact handoff and run lifecycle;
do not introduce a second browser stack, scheduler, approval queue or research
protocol. Keep untrusted text screened and bounded, and never expose credentials,
persist a profile implicitly, or share a mutable page between independent runs.
Remove the unsupported path and stale instructions when replacing them.

## Acceptance

- An authorized accessible source reaches the research agent and its reviewer;
  source evidence and task updates publish once through the existing lifecycle.
- Missing auth, denied authority, required confirmation and inaccessible content
  have distinct honest outcomes. Unchanged blockers do not repeatedly create
  approvals or fail the same workflow; changed authority/access can resume work.
- Public HTTP research remains available independently of authenticated browsing.
- Recovery preserves a collected result without repeating an ambiguous external
  action. No writer performs shared external effects before integration.
- Exercise the composed policy, collection and consumer boundary with controlled
  ports, then a suitable authorized live source when available. No fixture may
  label a destructive browser tool as a network read merely to make the test pass.
- This task does not require profile persistence or weakening the separate
  `task-security-review-browser-profile-persistence-checks` acceptance.

## Completion

Source collection now runs in the repository-free `research-source-collection`
workflow under the real browser tool effects and live scope policy. The existing
`research-retry` writer consumes the runtime-persisted, bounded and redacted
handoff, binds the target task resource, and verifies the task contract before
editing and after reconciliation. The agent and advisory semantic reviewer see
the same collected evidence. Shared workflow tool execution now applies tool
middleware before storing durable results, preserving injection screening on
recovery without repeating the external call.

Denied and confirmation-required authority remain distinct and parked until
existing scope controls permit collection. Missing authentication and inaccessible
content remain separate capability/attempt outcomes. Public HTTP remains
independent; automatic collection rejects profile persistence. Existing browser
session, network isolation, effect recovery, child deduplication and publication
owners remain authoritative.

Validation in builder run `2026-09-15T21-07-24-308Z-builder-da7lua`: static gate and
production build passed; five composed browser/policy/consumer cases passed;
research contract, dispatcher, browser lifecycle/isolation, tool session and
durable-effect recovery checks passed. The composed tests control Chromium,
model and validation subprocess ports while exercising the production owners.
One additional process-registration check could not launch because this sandbox
denies `/bin/ps`; its eight sibling context checks passed. A public live network
probe failed at the sandbox's configured proxy, so no live authenticated source
read or deployed observation is claimed. Logs and the detailed validation summary
are retained with this run's artifacts.

The critic's recovery findings were repaired in this same run. HTTP readings now
checkpoint before browser effects; browser invocation identities bind the URL
and tool instead of call order. Recovery preserves the HTTP fallback decision,
reuses completed browser results, and refuses ambiguous effects. Stale handoffs
with no writer changes can finish and release collection; stale writers retaining
changes still fail the contract invariant. Six composed collection cases, two
real-journal recovery cases, and fourteen research owner cases pass after repair.
