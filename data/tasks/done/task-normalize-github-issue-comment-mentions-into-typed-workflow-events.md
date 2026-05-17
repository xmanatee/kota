---
id: task-normalize-github-issue-comment-mentions-into-typed-workflow-events
title: Normalize GitHub issue-comment mentions into typed workflow events
status: done
priority: p2
area: modules
summary: Extend github-webhook beyond pull_request by normalizing issue_comment events with actor-integrity metadata and emitting an explicit mention-trigger event that workflows can consume without parsing raw GitHub payloads.
created_at: 2026-05-17T07:01:10Z
updated_at: 2026-05-17T07:11:31Z
---

## Problem

KOTA can receive GitHub pull-request webhooks, validate their HMAC signatures,
normalize actor integrity, and run the advisory `pr-reviewer` workflow. It can
also write GitHub issue and PR comments through the GitHub module. The missing
side is inbound GitHub comments: there is no typed `issue_comment` event, no
mention filter, and no actor-integrity decision for on-demand repository
requests.

That leaves future GitHub-native workflows with two bad options: parse raw
GitHub webhook payloads in each workflow, or reuse the generic webhook trigger
and lose the provider-specific trust and event-shape checks that
`github-webhook` now owns for pull requests.

## Desired Outcome

GitHub issue and PR comments that explicitly mention a configured KOTA alias
become a typed workflow event emitted by `github-webhook`. The event contains
normalized comment, issue/PR, repository, and actor-integrity metadata, so a
workflow can decide whether to answer, triage, or ignore the request without
handling raw GitHub payloads.

Non-mention comments, unsupported actions, missing actor metadata, low-trust
actors, and blocked actors are observable in focused tests and do not silently
reach an autonomous agent step.

## Constraints

- Keep GitHub webhook ingestion in `src/modules/github-webhook/`; do not move
  provider-specific event parsing into core or generic webhook routes.
- Reuse the actor-integrity posture already established for pull-request
  events. HMAC authenticity, mention detection, actor trust, and prompt
  injection labeling are separate gates.
- Do not add a full GitHub chat channel, issue triage workflow, or PR-comment
  answering agent in this task. The deliverable is the typed inbound event
  surface that those workflows can consume later.
- Do not hardcode this repository's usernames or mention strings. Mention
  aliases and trust policy belong in the owning module config, with explicit
  defaults covered by tests.
- Do not emit raw GitHub payloads as the workflow input. Normalize once at the
  external boundary and fail loudly in tests if the normalized protocol loses
  load-bearing fields.

## Done When

- `github-webhook` can accept `issue_comment` deliveries when configured and
  acknowledges unsupported or unconfigured comment events without throwing.
- A typed module event exists for configured mention comments, carrying at
  least repository identity, issue/PR number, whether the target is a PR,
  comment id/body/url, commenter identity, author association, actor-integrity
  state, and a clear reason.
- Mention detection is explicit and test-covered. Non-mentions and irrelevant
  actions do not emit the mention event.
- Missing actor metadata, low-trust actors, blocked actors, and allowed actors
  produce distinct normalized states or skip reasons.
- Existing `github.pull_request` behavior and actor-integrity tests continue to
  pass unchanged.
- Local `AGENTS.md` guidance under `src/modules/github-webhook/` is updated
  only if a durable boundary changes.

## Source / Intent

Explorer run `2026-05-17T06-58-58-881Z-explorer-quzfrr` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` are all still operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Normalize GitHub issue-comment mentions into typed workflow events" --state ready --area modules --priority p2 --summary "Extend github-webhook beyond pull_request by normalizing issue_comment events with actor-integrity metadata and emitting an explicit mention-trigger event that workflows can consume without parsing raw GitHub payloads."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed` in the network-restricted workflow sandbox. This file
follows the normalized task schema manually.

External signal checked:

- `https://github.com/google-gemini/gemini-cli` advertises a GitHub Action with
  PR reviews, issue triage, and on-demand assistance through `@gemini-cli`
  mentions in issues and pull requests.
- `https://github.com/anthropics/claude-code` advertises terminal, IDE, and
  GitHub usage via tagging `@claude` on GitHub.
- `https://github.com/github/gh-aw` reinforces that GitHub-hosted agent
  workflows need explicit guardrails and access gates. KOTA's actor-integrity
  pull-request gate already addresses that signal for PR webhooks; comment
  mentions are the remaining inbound GitHub shape.

Local evidence:

- `src/modules/github-webhook/index.ts` currently defaults to `push`,
  `pull_request`, and `check_run`; only pull requests have typed event
  declarations and actor-integrity normalization.
- `src/modules/github/index.ts` already provides issue and PR comment tools,
  so outbound GitHub comments are first-class while inbound comment mentions
  are not.
- `src/modules/autonomy/workflows/pr-reviewer/` is pull-request-only by
  design. This task should not broaden that workflow; it should add the typed
  event surface a future GitHub-native workflow can consume.

## Initiative

GitHub-native operator entry: repository comments should enter KOTA through a
typed module-owned event with provider-specific trust metadata, not through raw
webhook payload parsing inside autonomous workflows.

## Acceptance Evidence

- Focused test transcript for GitHub webhook event normalization:

```sh
pnpm test src/modules/github-webhook/github-webhook.test.ts
```

- A fixture or run artifact showing a configured mention comment emits the new
  typed event with actor-integrity metadata.
- A fixture or run artifact showing a non-mention comment and a low-trust or
  blocked actor do not reach a workflow agent step.
- Queue validation passes with this task in `data/tasks/ready/`.
