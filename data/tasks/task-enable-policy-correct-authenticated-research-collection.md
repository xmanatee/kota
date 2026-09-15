---
status: open
priority: p1
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
