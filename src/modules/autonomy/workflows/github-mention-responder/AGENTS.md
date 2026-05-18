# GitHub Mention Responder Workflow

This workflow turns trusted `github.issue_comment.mention` events into one
bounded GitHub thread response.

- Consume only the normalized mention event emitted by `github-webhook`.
- Keep actor-integrity, action, malformed-payload, and implementation-request
  gating in code before the response agent runs.
- Keep the agent passive and response-only. GitHub posting happens through the
  `github_comment` tool after the existing workflow approval step.
- Implementation requests are intake-owned. This workflow should skip them so
  `github-mention-intake` can create or reject the repo-local work item.
- Do not turn this into a multi-turn GitHub channel. If session routing becomes
  necessary, add a channel as the public surface.
