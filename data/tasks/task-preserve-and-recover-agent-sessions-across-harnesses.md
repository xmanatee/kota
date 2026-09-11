---
status: open
priority: p1
---

# Preserve and recover agent sessions by default across all harnesses

## Outcome

Session continuity is the default for every KOTA agent adapter and invocation
path. Preserve recoverable conversations and make a best-effort recovery attempt
when continuing the same work. Starting over or discarding session state must be
an explicit, evidenced exception, not an accidental consequence of process exit,
retry, quota backoff, daemon restart, or worktree cleanup.

## Observed Gap

- The Codex adapter rejects `persistSession` and `resumeSessionId`, always passes
  `--ephemeral`, and creates an invocation-local `CODEX_HOME`. The installed CLI
  supports `codex exec resume <session-id>`; this is an integration gap, not a
  provider limitation. See `src/modules/codex-agent-harness/{adapter,cli-runner,runtime-home}.ts`.
- Run `2026-09-08T22-45-09-535Z-builder-hjhox7` retains useful dirty work and repair
  artifacts but cannot resume its ephemeral native conversation. On September 11
  its in-flight build had no completed step output or durable continuation wait.
  Retaining a worktree or recording a thread ID alone does not preserve a session.
- Gemini CLI and Vercel reject persistence/resume; thin rejects resume; AGY passes
  a conversation ID but rejects `persistSession`. Inspect actual retention and
  restart behavior rather than inferring support from an option or capability flag.
- Shared run options already expose persistence/resume, and model-client session
  reconstruction exists. Reuse the implementation behind archived task
  `task-add-kota-owned-session-resume-for-model-client-har`. The active
  `task-make-builder-continuation-evidence-driven-and-prio` owns continuation
  decisions and calibration; this task owns durable session continuity, not a
  competing repair loop or scheduler.

## Required Changes

- Trace all registered harnesses and their callers: interactive sessions, workflow
  agents, nested/delegated agents, critics, repair and integration continuations.
  Put default preservation and recovery selection at the shared owning boundary;
  keep provider-specific session formats and launch commands inside adapters.
- Prefer provider-native persistence/resume where supported. Otherwise reuse
  KOTA's existing neutral conversation store and reconstruction where compatible.
  Verify each adapter's real capability; a genuine unsupported capability is a
  visible exception, not permission to silently discard recoverable context.
- Bind durable provider session identity and storage to the owning KOTA logical
  session/run before relying on recovery. Capture identity/checkpoints as soon as
  available during execution, not only in a successful final step result. Preserve
  the mapping across process replacement and workflow attempts using existing
  state/evidence owners; no parallel session registry or recovery engine.
- Replace unconditional ephemeral launches for resumable work. Separate durable,
  protected session storage from disposable credentials, generated permissions,
  process homes and temporary files. Refresh authentication and apply current
  scope/tool/security policy on resume; never inherit obsolete authority.
- Resume only the explicitly owned conversation, never a global "last session".
  Concurrent tasks, scopes and distinct agent roles must not share mutable session
  ownership. Independent critics and unrelated tasks get separate preserved
  conversations; authorized handoffs use the existing transfer contract.
- Handle clean interruption, crash, provider backoff, missing/corrupt/expired
  sessions and incompatible context honestly. Distinguish authentication or quota
  failure from irrecoverable session loss. Avoid infinite resume retries and silent
  fresh-session fallback. When recovery is impossible or intentionally declined,
  retain available evidence, record the reason and successor lineage, and continue
  safely from saved work where possible. Never replay ambiguous external effects
  or imply that a process instruction pointer was restored.
- Preserve sessions while work remains recoverable, including needs-attention and
  pending integration. Ordinary sandbox cleanup must not erase durable continuity.
  Explicit owner reset, security invalidation and documented retention/expiry may
  retire state with an observable disposition. Protect provider-native state from
  agent file access and public logs; preserve normal redaction and retention rules.
- Update existing capability declarations, scoped guidance and tests to reflect
  actual behavior. Remove obsolete forced-discard defaults and contradictory
  instructions rather than layering new flags, compatibility paths or copied stores.

## Acceptance Evidence

Provide a concise adapter matrix: native or KOTA-owned persistence, storage owner,
resume path, exercised evidence, and any justified limitation. A documented
exception must explain why available mechanisms cannot preserve continuity.

Demonstrate interruption and daemon restart after a thread starts but before its
agent step returns: saved work and session identity survive, the continuation
uses prior conversational context, ownership stays unique, and current policy is
enforced. Include a native Codex recovery and an existing model-client recovery;
exercise other adapters through their real interfaces with controlled external
ports, reporting unavailable live-provider validation explicitly.

Keep shared behavior tests at the shared owner and adapter tests to distinct
provider behavior. Reuse existing fixtures and cover missing-session recovery,
cleanup retention and concurrent isolation without copying a lifecycle matrix for
every adapter. Do not fake persistence by checking a flag or fabricate a transcript
for previously ephemeral sessions. Existing unrecoverable native histories remain
an explicit limitation; retained work and ordinary evidence must not be lost.
