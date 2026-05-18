---
id: task-route-trusted-github-implementation-mentions-into-task-intake
title: Route trusted GitHub implementation mentions into task intake
status: ready
priority: p2
area: modules
summary: Add a safe GitHub mention workflow path that turns trusted implementation requests into repo-local task intake and replies with the created reference instead of dropping them as unsupported.
created_at: 2026-05-18T04:48:38Z
updated_at: 2026-05-18T04:48:38Z
---

## Problem

KOTA now receives typed `github.issue_comment.mention` events and can answer
bounded questions in-thread, but the current mention workflow treats
implementation requests as unsupported. A trusted actor who writes
`@kota please fix this bug` gets a comment explaining that the GitHub mention
entry point cannot implement code changes, create branches, claim tasks, or run
autonomous build work.

That was the right first slice, but it leaves the GitHub-native entry point
short of KOTA's own queue model. Implementation asks should become explicit
repo-local work items, not disappear as comments that humans must re-enter by
hand. The hard part is doing that without letting untrusted GitHub text become
unscreened builder instructions or turning GitHub comments into a second task
system.

## Desired Outcome

Trusted GitHub implementation mentions enter KOTA's normal task intake path.
When the normalized mention payload is trusted, actionable, and concrete
enough, KOTA creates a repo-local task or inbox capture through the existing
repo-tasks surface and posts one bounded reply that names the created reference.
When the request is too vague or unsafe to normalize, KOTA posts a bounded
response asking for the missing acceptance detail and creates no task.

The existing response-only workflow stays passive. Implementation mentions
should be routed through a separate intake path or a clearly separated branch
that preserves the local `github-mention-responder` contract: no worktree
mutation by the answer agent, no multi-turn GitHub channel, and no direct
autonomous code execution from a comment.

## Constraints

- Consume only the normalized `github.issue_comment.mention` event. Do not
  parse raw GitHub webhook payloads in the intake workflow.
- Gate actor integrity, action, malformed payloads, and request classification
  before any task-writing step.
- Treat `commentBody`, `issueTitle`, and other GitHub-authored text as
  untrusted source material. Preserve owner wording in `## Source / Intent`,
  but label provenance so a later builder can distinguish the request from
  KOTA instructions.
- Use the repo-tasks domain as the task queue boundary. Do not hand-roll a
  second GitHub issue tracker, task file schema, or routing registry.
- If the workflow mutates `data/tasks/` or `data/inbox/`, make it recovery
  capable per the autonomy workflow contract and avoid replaying external
  GitHub comments after a crash.
- Keep GitHub API writes in the `github` module and webhook ingestion in
  `github-webhook`; declare module dependencies instead of hidden imports.
- Do not skip approval policy. Any GitHub reply or repo mutation that current
  guardrails classify as approval-worthy must use the existing approval queue.
- Do not turn implementation mentions into immediate builder runs in this
  slice. Creating or capturing the work item is enough.

## Done When

- Trusted implementation mentions no longer receive only the hard-coded
  unsupported response. They create a repo-local task or inbox capture when
  the request is concrete enough, then post a bounded reference reply.
- Vague or unsafe implementation mentions produce a bounded "needs more detail"
  reply and create no task.
- The created task or capture includes the originating repo, issue/PR number,
  comment URL, actor identity, actor-integrity reason, and the untrusted GitHub
  request text in `## Source / Intent` or the inbox equivalent.
- Tests prove blocked, low-trust, missing-metadata, malformed, and unsupported
  action payloads cannot create tasks, post misleading references, or reach an
  agent step.
- Tests prove the existing bounded Q&A response path still answers
  non-implementation mentions and that the passive responder contract remains
  intact.
- Queue validation passes with the generated task/capture shape, including
  unique ids, matching status/directories, and no stale deletes.

## Source / Intent

Explorer run `2026-05-18T04-46-56-577Z-explorer-0g72bd` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` were all operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Route trusted GitHub implementation mentions into the task queue" --state ready --area modules --priority p2 --summary "Add a safe GitHub mention workflow path that turns trusted implementation requests into normalized KOTA tasks and replies with the task reference instead of dropping them as unsupported."
```

It failed before writing a file because the local preflight returned
`Fatal: fetch failed` in the network-restricted workflow sandbox. This file
follows the normalized task schema manually.

External signals already tracked in the watchlist show that peer coding agents
have made repository comments a first-class operator entry: Claude Code
advertises GitHub `@claude` tagging, Gemini CLI advertises mention-driven issue
and PR assistance, and GitHub Agentic Workflows reinforces guarded repository
agent entry points. KOTA has already completed the typed mention event and
bounded answer workflow slices. The remaining nonduplicative gap is routing
trusted implementation asks into KOTA's own task intake instead of requiring a
human to copy the request into `data/inbox/` or `data/tasks/`.

Local evidence:

- `src/modules/autonomy/workflows/github-mention-responder/workflow.ts`
  classifies implementation requests and returns `decision: "unsupported"`.
- `src/modules/autonomy/workflows/github-mention-responder/AGENTS.md` keeps
  the current workflow passive and response-only, so implementation intake
  should be separated from the answer agent contract.
- `src/modules/github-webhook/AGENTS.md` confirms issue-comment mentions own
  actor-integrity normalization at the provider boundary.
- `src/modules/repo-tasks/AGENTS.md` makes `repo-tasks` the canonical task
  queue domain and schema/validation boundary.

## Initiative

GitHub-native operator entry: trusted repository comments should feed KOTA's
normal task queue without bypassing actor integrity, approval policy, prompt
trust labeling, or the repo-local task schema.

## Acceptance Evidence

- Focused test transcript covering mention classification, task/capture
  creation, and reference replies, for example:

```sh
pnpm test src/modules/autonomy/workflows/github-mention-responder/workflow.test.ts src/modules/github-webhook/github-webhook.test.ts src/modules/repo-tasks/task-queue-validation.test.ts
```

- A fixture or run artifact showing a trusted implementation mention producing
  a repo-local task or inbox capture with GitHub provenance and untrusted source
  labeling.
- A fixture or run artifact showing a low-trust implementation mention creates
  no task and posts no misleading "created" reference.
- `pnpm validate-tasks` or the source-mode equivalent passes after the generated
  task/capture fixture is present.

## Out of Scope

- Directly implementing the requested code change from the GitHub comment.
- Creating a multi-turn GitHub channel.
- Mirroring GitHub issues as a parallel task database.
