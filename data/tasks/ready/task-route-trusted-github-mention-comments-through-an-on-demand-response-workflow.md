---
id: task-route-trusted-github-mention-comments-through-an-on-demand-response-workflow
title: Route trusted GitHub mention comments through an on-demand response workflow
status: ready
priority: p2
area: modules
summary: Consume github.issue_comment.mention events with actor-integrity gating, run a bounded KOTA response workflow, and post the result back to the originating GitHub issue or PR without parsing raw webhook payloads.
created_at: 2026-05-17T07:35:32Z
updated_at: 2026-05-17T07:35:32Z
---

## Problem

`github-webhook` now normalizes issue and PR comments that mention a configured
KOTA alias into the typed `github.issue_comment.mention` event. That closes the
external-boundary problem, but there is still no consumer. A trusted GitHub
mention is acknowledged by the webhook module and then stops at the event bus.

Peer coding agents have made repository comments a first-class operator entry:
operators can tag an agent in an issue or pull request and get a bounded answer
or review in the same thread. KOTA has the required pieces now — a typed
comment-mention event, actor-integrity metadata, GitHub comment tools, and
autonomy workflows — but they are not wired into a single on-demand response
path.

## Desired Outcome

Trusted GitHub mention comments trigger a narrow autonomy workflow that can
answer the request and post a bounded response back to the originating issue or
pull request. The workflow consumes only the normalized
`github.issue_comment.mention` payload, rejects or records untrusted actor
states before any agent step, treats the comment body as untrusted content, and
uses the existing GitHub comment capability for the external write.

The first slice should be a single-turn response workflow, not a full GitHub
chat channel. It should make GitHub mention entry usable while preserving the
option to add a proper channel later if multi-turn session routing becomes the
right public surface.

## Constraints

- Consume `github.issue_comment.mention`; do not parse raw GitHub webhook
  payloads in the workflow.
- Keep GitHub webhook ingestion in `src/modules/github-webhook/` and GitHub API
  writes in `src/modules/github/`. The autonomy workflow may depend on both
  modules through declared module dependencies, not hidden imports.
- Gate on actor-integrity state before the agent step. Blocked, low-trust, or
  missing-metadata actors must not reach a response-generating agent.
- Preserve the untrusted-content boundary for `commentBody`, `issueTitle`, and
  any other GitHub-authored text exposed to the agent.
- Do not broaden `pr-reviewer`; create a focused workflow for mention-response
  behavior.
- Do not add a second approval or owner-question surface. If posting the
  GitHub response needs approval under current autonomy/tool-risk policy, route
  through the existing approval queue and make that state visible in the run.
- Keep the response bounded: no autonomous code mutation, branch creation, or
  task claiming in this slice. If the mention asks for implementation work, the
  workflow should reply with a clear unsupported/deferred response or create a
  follow-up task only through an existing approved path.

## Done When

- A new focused autonomy workflow triggers on `github.issue_comment.mention`
  and has tests for run/skip decisions.
- The workflow rejects or records skip reasons for unsupported actions,
  blocked actors, low-trust actors, missing actor metadata, and malformed
  normalized payloads before any agent step runs.
- The response agent receives the normalized repository, issue/PR, comment, and
  actor fields with GitHub-authored text labeled as untrusted content.
- Successful runs post exactly one response comment to the originating
  issue/PR through the existing GitHub capability, or queue the existing
  approval item required to do so.
- Tests or fixtures prove a configured mention comment can reach the response
  path, while a non-allowed actor cannot reach an agent step or comment write.
- Existing `pr-reviewer`, `github-webhook`, and GitHub tool tests remain green.

## Source / Intent

Explorer run `2026-05-17T07-33-50-289Z-explorer-wzpv5l` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` are all still operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Route trusted GitHub mention comments through an on-demand response workflow" --state ready --area modules --priority p2 --summary "Consume github.issue_comment.mention events with actor-integrity gating, run a bounded KOTA response workflow, and post the result back to the originating GitHub issue or PR without parsing raw webhook payloads."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed` in the network-restricted workflow sandbox. This file
follows the normalized task schema manually.

Watchlist signals considered:

- `https://github.com/anthropics/claude-code` advertises GitHub tagging as a
  repository-native operator entry.
- `https://github.com/google-gemini/gemini-cli` advertises issue and PR
  mention-driven assistance through its GitHub Action.
- `https://github.com/github/gh-aw` reinforces explicit guardrails for
  repository agents; KOTA's actor-integrity gate now supplies the local trust
  boundary.

Local evidence:

- `src/modules/github-webhook/events.ts` declares
  `githubIssueCommentMentionEvent`.
- `src/modules/github-webhook/index.ts` emits
  `github.issue_comment.mention` for configured mention comments.
- `src/modules/github/github-issues.ts` already contributes `github_comment`.
- `src/modules/autonomy/workflows/pr-reviewer/` consumes only
  `github.pull_request`, so no workflow consumes the mention event today.
- `data/tasks/done/task-normalize-github-issue-comment-mentions-into-typed-workflow-events.md`
  intentionally scoped out a full GitHub answering workflow, making this the
  next coherent slice rather than duplicate ingestion work.

## Initiative

GitHub-native operator entry: repository comments should be able to reach KOTA
through a typed, guarded event and receive a bounded response in the same
GitHub thread.

## Acceptance Evidence

- Focused workflow and webhook/tool integration test transcript, for example:

```sh
pnpm test src/modules/autonomy/workflows/github-mention-responder/workflow.test.ts src/modules/github-webhook/github-webhook.test.ts src/modules/github/github.test.ts
```

- A fixture or run artifact showing an allowed `github.issue_comment.mention`
  payload posts or queues exactly one GitHub response comment.
- A fixture or run artifact showing a blocked or low-trust actor is skipped
  before any response agent step or GitHub comment write.
