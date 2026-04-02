---
id: task-github-actions-integration
title: GitHub Actions integration pattern for KOTA webhook triggers
status: done
priority: p3
area: integrations
summary: Document and provide a reusable example for triggering KOTA workflows from GitHub Actions using the signed webhook trigger, enabling teams to kick off builder or custom workflows on push, PR, or release events.
created_at: 2026-04-02T11:35:00Z
updated_at: 2026-04-02T13:41:47Z
---

## Problem

KOTA's webhook trigger supports signed POST requests, and the daemon exposes an HTTP endpoint for inbound webhooks. However, there is no documentation or example showing how to invoke a KOTA workflow from a GitHub Actions workflow. Teams trying to adopt KOTA in a CI pipeline must piece this together manually.

## Desired Outcome

A `docs/GITHUB-ACTIONS.md` guide explains:

- How to store the KOTA webhook secret as a GitHub Actions secret.
- A reference GitHub Actions step using `curl` to POST a signed payload to `POST /webhooks/<workflow>`.
- How to compute the HMAC-SHA256 signature in a shell one-liner (compatible with GitHub Actions runners).
- Notes on network access (the daemon must be reachable from the runner; typical setup is a self-hosted runner or SSH tunnel).

An example `.github/workflows/kota-trigger.yml` file is committed under `examples/` illustrating a complete on-push trigger.

## Constraints

- No new KOTA server or webhook code changes required; this is documentation and example-only work unless the review reveals a real gap (e.g., the endpoint silently drops non-loopback requests — worth verifying).
- The guide should be actionable for teams already using KOTA with a webhook-enabled workflow.

## Done When

- `docs/GITHUB-ACTIONS.md` exists with working curl + HMAC example.
- `examples/github-actions/` contains a sample workflow YAML.
- `docs/WORKFLOWS.md` has a brief cross-reference linking to the new guide under the webhook trigger section.
