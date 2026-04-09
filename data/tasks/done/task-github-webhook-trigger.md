---
id: task-github-webhook-trigger
title: Add GitHub webhook trigger module for push and PR events
status: done
priority: p2
area: runtime
summary: KOTA can receive generic webhooks and trigger workflows, but has no GitHub-aware module that parses push, pull_request, and check_run events from GitHub Webhooks. An module that handles GitHub webhook delivery signatures and emits typed bus events would let operators trigger KOTA workflows on PR opens, pushes, and CI completions.
created_at: 2026-04-01T11:02:00Z
updated_at: 2026-04-01T11:02:00Z
---

## Problem

The existing webhook workflow trigger (`type: webhook`) receives arbitrary HTTP POSTs and fires a workflow when the body matches a filter. It has no concept of GitHub's webhook signature (`X-Hub-Signature-256`), event type (`X-GitHub-Event`), or payload structure. Operators wanting to trigger KOTA on GitHub events must manually verify signatures and parse payloads in their workflow code — duplicating infrastructure logic that belongs in an module.

The GitHub module (recently added) provides tools for PR/issue operations but is invoked by the builder, not by incoming GitHub events. There is no way for a push to `main` or an opened PR to automatically kick off a KOTA workflow.

## Desired Outcome

A `github-webhook` module that:
- Registers a webhook receive handler (via the module `onWebhookReceived` hook or equivalent daemon webhook route).
- Validates the `X-Hub-Signature-256` HMAC signature using a configured secret.
- Emits a typed bus event `github.push`, `github.pull_request`, or `github.check_run` with a normalized payload (repo, ref/branch, PR number, etc.).
- Allows workflow definitions to use these events as triggers via `event: "github.push"`, `event: "github.pull_request"`, etc.

Example use case: a workflow that runs `kota workflow trigger builder` whenever a PR is merged to `main`.

## Constraints

- Signature validation is not optional; reject unsigned or invalid deliveries with HTTP 401.
- Secret is configured as `$ENV_VAR` reference (same pattern as GitHub module token).
- Emit only the event types the operator enables via config (`events: ["push", "pull_request"]`); ignore others.
- No new npm dependencies; use `node:crypto` for HMAC.
- The module must not import or depend on the GitHub REST tools module (`modules/github`).
- Document the webhook endpoint URL format and GitHub webhook setup steps in `docs/EXTENSIONS.md` or a new `docs/GITHUB-WEBHOOK.md`.

## Done When

- The module validates signatures and emits `github.<event>` bus events for configured event types.
- Workflow definitions can use `github.push`, `github.pull_request`, `github.check_run` as event triggers.
- HMAC validation failure returns HTTP 401 and emits a warning log.
- Unit tests cover: valid delivery fires event, invalid signature is rejected, unconfigured event type is ignored.
- Documentation covers GitHub webhook setup.
