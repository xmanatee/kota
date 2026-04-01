---
id: task-run-show-trigger-payload
title: Surface trigger payload in kota workflow run show
status: backlog
priority: p3
area: cli
summary: kota workflow run show displays the trigger event name but not its payload. For webhook and github-event triggered runs the payload carries critical context (repo, branch, PR number) that operators need to debug why a run fired.
created_at: 2026-04-01T11:42:09Z
updated_at: 2026-04-01T11:42:09Z
---

## Problem

`kota workflow run show <id>` prints `Trigger: github.push` but nothing about the payload
that accompanied the event. For workflows triggered by `github.push`, `github.pull_request`,
or an inbound webhook, the payload (repo, branch, PR number, sender, etc.) is the primary
signal operators need to confirm that the right run fired for the right input.

The full trigger payload is stored in `metadata.json` on disk as `trigger.payload`, but:
- The disk read path in `run-show.ts` has access to it but never displays it.
- The daemon API response (`WorkflowRunDetail`) does not include `triggerPayload`, so
  the live path reconstructs with `payload: {}`, discarding the data entirely.

## Desired Outcome

A `--payload` flag on `kota workflow run show <id> --payload` that prints the trigger
payload as formatted JSON below the Trigger line:

```
Trigger:  github.push
Payload:
  {
    "repo": "owner/repo",
    "ref": "refs/heads/main",
    "branch": "main",
    "commits": 2,
    "pusher": "alice"
  }
```

When the daemon is running, the payload must be retrievable via the API (requires extending
`WorkflowRunDetail` in `daemon-control-types.ts` and populating it in `daemon.ts`).

When the daemon is offline, read from the disk `metadata.json` directly (already available).

## Constraints

- Add `triggerPayload?: Record<string, unknown>` to `WorkflowRunDetail` in
  `src/scheduler/daemon-control-types.ts`.
- Populate it in `daemon.ts` when building the run detail for `getWorkflowRun`.
- Only print the payload section when `--payload` is passed; do not change the default
  output.
- If the payload is `{}` or missing, print nothing (no empty payload block).
- No new dependencies.

## Done When

- `kota workflow run show <id> --payload` prints the trigger payload as formatted JSON.
- Works against both the live daemon and offline disk reads.
- `WorkflowRunDetail.triggerPayload` is populated in the daemon API for all run types.
- Type-checking and linting pass.
