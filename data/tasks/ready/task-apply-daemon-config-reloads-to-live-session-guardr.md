---
id: task-apply-daemon-config-reloads-to-live-session-guardr
title: Apply daemon config reloads to live session guardrails
status: ready
priority: p2
area: architecture
summary: Make daemon config reloads update guardrail and supervision-sensitive runtime state for existing live sessions, with explicit session snapshots and tests, so policy changes do not only affect sessions created after reload.
created_at: 2026-05-26T01:41:38.214Z
updated_at: 2026-05-26T01:41:38.214Z
---

## Problem

KOTA has a daemon config reload path, but live interactive sessions keep the
guardrail policy snapshot they were created with. `AgentSession` copies
`options.config?.guardrails` into `state.guardrailsConfig` during construction,
and later tool calls use that stored value. The daemon reload path updates
workflow definitions and emits a typed reload event, but daemon-owned chat
sessions and server/serve-backed sessions are not told that a tool policy
changed.

That means an operator can tighten `.kota/config.json` from `dangerous:
allow` to `dangerous: queue`, run `kota daemon reload`, see a successful reload,
and still have an already-live session evaluate its next tool call under the old
policy. The inverse is also confusing: relaxing a policy requires opening a new
session even though the daemon reports that config is current.

Codex's current runtime direction makes this explicit: its 0.133.0 release
calls out permission-profile inheritance and runtime refresh behavior. KOTA
does not need to copy Codex's permission-profile surface, but it does need the
same invariant for its existing guardrails: active authority state must have an
auditable refresh boundary.

## Desired Outcome

Daemon config reloads apply guardrail policy changes to existing live sessions
without recreating their conversation, model client, prompt context, or tool
history. A session records which guardrail config snapshot it is currently
using, and the reload path updates daemon-owned sessions or reports exactly
which sessions could not be updated because they are owned by another process.

Operators can verify the active policy snapshot through existing session or
daemon status surfaces, and the next tool call after reload uses the refreshed
policy.

## Constraints

- Do not add a new public permission-profile DSL unless a builder proves the
  existing `guardrails` config cannot represent the needed behavior. The default
  solution should refresh KOTA's current typed guardrails config.
- Keep autonomy mode separate from guardrail policy. `setAutonomyMode` remains
  the explicit route for changing passive/supervised/autonomous posture.
- Do not silently re-render the system prompt, swap the model, or restart live
  sessions as a side effect of policy reload. If a future config field cannot be
  safely applied live, report it as non-refreshable instead of pretending.
- Preserve daemon/serve ownership boundaries. Daemon-owned chat sessions can be
  mutated in-process; serve-registered sessions are metadata rows unless a
  forwarding protocol exists.
- Keep exact state shape and events in source types and tests, not durable docs.

## Done When

- `AgentSession` exposes a narrow method for replacing its guardrails config
  and recording a stable snapshot id/fingerprint.
- `kota daemon reload` refreshes guardrails on every daemon-owned live chat
  session before it reports success, and the daemon reload event or response
  records how many sessions were refreshed and how many were not refreshable.
- Serve-owned session rows are handled explicitly: either the reload response
  marks them as non-refreshable with an operator-visible reason, or a forwarding
  path updates the remote serve process.
- A regression test proves an existing session whose old policy allowed a
  dangerous tool queues or denies the same tool immediately after a guardrails
  reload tightens the policy.
- A second regression test proves a reload that only changes unrelated module
  config does not churn session policy snapshots.
- Session/status inspection shows the active guardrails snapshot or reload
  generation for live sessions.

## Source / Intent

Explorer run `2026-05-26T01-39-09-501Z-explorer-2rx24q` fired on
`autonomy.queue.empty`: zero ready/doing tasks, two dependency-blocked backlog
research tasks, and five strategic blocked alternatives that all still require
operator-captured artifacts.

Strategic blocked alternatives considered but not chosen:

- `task-add-cross-preset-runtime-parity-gate` — still waiting on
  `.kota/runs/preset-parity-all-keys-set/`.
- `task-add-streamable-http-transport-to-the-mcp-server` — still waiting on a
  live HTTP endpoint transcript.
- `task-capture-an-end-to-end-coding-task-parity-artifact-` — still waiting on
  operator harness-parity artifacts.
- `task-enable-autonomous-access-to-auth-walled-sources-so` — still waiting on
  live authenticated-browser source-access capture.
- `task-introduce-a-rich-cli-rendering-abstraction-for-all` — still waiting on
  peer-CLI comparison artifacts.

External primary source checked:

- `https://github.com/openai/codex/releases` — the latest stable release shown
  during this run was `0.133.0` on 2026-05-21. Its release notes say permission
  profiles gained inheritance, managed requirements, runtime refresh behavior,
  and stronger sandbox integration.

Local evidence:

- `src/core/loop/loop-constructor.ts` assigns `state.guardrailsConfig` once from
  `options.config?.guardrails` or defaults during session construction.
- `src/core/loop/loop-send.ts` passes `state.guardrailsConfig` into
  `executeToolCalls`, so later calls keep using the stored snapshot.
- `src/core/daemon/daemon-handle.ts` reloads config, workflow inputs, and module
  metadata, then emits `daemon.config.reload`; it does not refresh existing
  sessions.
- `src/core/daemon/daemon-init.ts` captures `daemonConfig` at daemon
  construction and uses it when creating daemon-owned chat sessions.
- Repository search found no existing open task for live-session guardrail
  refresh after config reload.

## Initiative

Runtime authority freshness: KOTA's daemon reload path should make policy
changes real for active sessions, not just for future sessions and workflow
definitions.

## Acceptance Evidence

- Focused unit/integration tests for `AgentSession` and daemon chat/config
  reload behavior pass.
- A daemon reload test or transcript under `.kota/runs/<run-id>/` shows a live
  session created under one guardrail policy, the config reloaded to a stricter
  policy, and the next dangerous tool call using the stricter policy without
  recreating the conversation.
