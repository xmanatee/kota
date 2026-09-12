---
status: done
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

Validate interruption and reconstruction at the shared persistence/process owner:
saved work and session identity survive, the continuation receives prior context,
ownership stays unique, and current policy is enforced. Exercise native Codex and
model-client adapters through their real interfaces with controlled external ports;
run authenticated live recovery when the execution context permits it. A denied
nested daemon or provider probe is a reported validation limitation, not a reason
to strand an otherwise correct implementation. The launching daemon's restart
and post-publication live recall are operational follow-up, not prerequisites
for this builder to publish. Never claim those unperformed checks passed.

Continue retained run `2026-09-11T04-24-50-234Z-builder-lqcsbw` under this revised
contract through normal recovery. Preserve its existing changes and finish the
implementation with available proportionate verification; do not start over or
wait for an operator to manufacture historical artifacts.

Keep shared behavior tests at the shared owner and adapter tests to distinct
provider behavior. Reuse existing fixtures and cover missing-session recovery,
cleanup retention and concurrent isolation without copying a lifecycle matrix for
every adapter. Do not fake persistence by checking a flag or fabricate a transcript
for previously ephemeral sessions. Existing unrecoverable native histories remain
an explicit limitation; retained work and ordinary evidence must not be lost.

## Retained implementation and evidence (September 11)

The retained changes move the existing neutral conversation store to core and
make preservation the shared runner default. Stable workflow, role, delegate,
handoff, REPL and Telegram ownership selects exact conversations. Native IDs
checkpoint before completion; provider state stays outside disposable homes and
worktrees. Codex uses explicit native resume, Claude uses the SDK mirror store,
AGY retains its remote conversation ID, and ModelClient, Gemini SDK and AI SDK
adapters reconstruct stored context. Reset and proven session loss retain prior
state and record successor reasons. Gemini CLI remains a visible exception
because its authenticated native execution is already unavailable at the
credential isolation boundary.

The builder run `2026-09-11T04-24-50-234Z-builder-lqcsbw` retains the adapter matrix
and exact validation results in its ordinary agent artifacts. Focused recovery
proof includes an abrupt hosting-process exit before a result, fresh-process
context recovery, saved work, concurrent ownership, current instructions,
corrupt/missing-session succession, native home retention, and installed Claude
SDK readers. Controlled adapter and REPL/cancellation tests pass. These proofs do
not establish authenticated native Codex recall or a complete daemon restart
journey; the revised contract treats those observations as operational follow-up.

## Completion (September 12)

Completed under the retained builder lineage and revised acceptance contract.
Post-check repair now preserves the initial agent-step conversation through
context dispatch. Foreach agent and nested code-step calls have separate stable
item ownership, including equal inputs, and recover that ownership across repair
and durable run replacement. The stale import-order findings are resolved.

The final critic repair protects the complete canonical and workspace conversation
stores in Claude's pre-tool hook, permission callback and shell sandbox, including
sibling conversations and retired provider generations. Shared continuity now
holds SQLite OS locks for logical owners and native session identities across
independent hosts, including CLI resume and reset. Process death releases those
locks without expiring or deleting retained conversation evidence.

The ordinary run summary contains the adapter matrix and current verification.
`pnpm check:fast` passed. The workflow-session and foreach regression suites passed
all 20 tests, after three new regression cases first reproduced the critic's
failures. The broader affected-owner and integration selection passed 192 of 194
tests across 26 files; the two command-process failures report sandbox denial of
`/bin/ps` before launch. Production TypeScript emission passed into the authorized
run artifact directory. These checks cover shared interruption/reconstruction,
unique ownership, current policy, native storage retention, controlled adapter
interfaces, delegates, and the REPL journey.

Final repair validation: `pnpm check:fast` passed; 88 selected owner tests across
13 files and all eight REPL integration tests passed. The process-boundary test
rejects overlapping resumes and resets from separate hosts, permits independent
conversations, then observes both completed turns after resume. Existing abrupt
process-exit recovery still passes. Claude checks reject current, sibling,
retired and native transcript paths through the real hook and permission callback,
and verify shell read/write denial coverage. No authenticated provider execution
was used in these controlled tests.

Authenticated native recall, launching-daemon restart, and full asset packaging
were not performed in this repair. The normal build output is runtime-provided
and the earlier build attempt could not replace it; artifact-directory emission
provides compiler proof without modifying that output. These are reported
validation and operational limitations under the revised contract, not claims
of completed live validation. Existing ephemeral histories remain unrecoverable;
retained work and evidence remain intact. Only this task is resolved.

## Cancellation and checkpoint repair

The September 12 critic's remaining defects are repaired. Shared hosted-adapter
cancellation retains conversation locks until execution settles, including
Claude's final SDK mirror writes; output cancellation still returns promptly.
Native adapters retain their confirmed-stop barrier. Explicit identity lookup
skips unrelated malformed checkpoint records without deleting evidence or hiding
I/O errors.

Both defects first reproduced in controlled tests. The affected selection passed
124 tests across 19 files; the final regression selection passed all 19 tests.
The Claude journey rejects overlapping owner-key resume, explicit-id resume and
reset while the cancelled SDK drains, then recovers the same identity with its
final mirror write. Shared tests recover healthy context past unrelated malformed
JSON and schema records. `pnpm check:fast` passed. The ordinary run summary and
`cancellation-repair-*.log` artifacts retain results and unchanged live-validation
limitations. This completes the implementation; independent review and publication
remain runtime-owned.

## Shutdown identity and Telegram reset repair

The follow-up critic exposed identity first arriving during SDK shutdown and
Telegram reset confusing caller cancellation with adapter settlement. Durable
identity checkpoints now remain validated and writable while the adapter owns
the conversation, independently of suppressed caller output; callbacks after
ownership release cannot mutate the checkpoint. The shared runner exposes
settlement for teardown owners. Telegram waits for that release before retiring
state, shares concurrent clears, rejects sends during clearing with a wait reply,
and removes closed cached agents even if retirement fails.

The shutdown-identity regression first failed with a fresh invocation receiving
no saved context, then passed with exact-identity resume and both transcript
writes restored. A real Telegram command/cache plus Claude SDK-store journey
exercises active `/clear`, a concurrent clear, a message during shutdown, retained
old evidence, and a successful fresh conversation afterward. External query and
HTTP ports are controlled. All 142 selected tests across 16 files passed, as did
`pnpm check:fast`. The ordinary run summary and `checkpoint-reset-*.log` artifacts
record the proof. Authenticated provider recall and launching-daemon restart
remain unperformed operational observations. The targeted task remains done.


## Telegram ModelClient recovery repair

Provider-qualified Telegram models now bind their direct AgentSession to the
same bot/chat/scope continuity owner as harness sessions. The core loop reuses
the shared neutral store and bounded recovery policy, checkpoints before model
and tool effects, and rebuilds current instructions and policy. Disposing the
session waits for active sends before `/clear` retires its state.

The real Telegram command/cache and AgentSession integration restores prior
messages after replacement and credential rotation, isolates another chat,
clears before first post-restart use, preserves an authentication-failed request,
retains corrupt evidence with a successor disposition, and waits for active-turn
settlement during clear. Model and HTTP ports are controlled. All 106 selected
owner/integration tests and `pnpm check:fast` passed. Guidance added by this task
was condensed below the loader cap; a production loader probe confirms the
trailing continuity rules are included. Wider instruction/scope fixture cleanup
was sandbox-denied. Authenticated provider recall and launching-daemon restart
remain unperformed; the task remains done.

## Default session-factory repair

Direct ModelClient sessions now preserve by default, including callers that omit
`continuityKey` and disable history. Existing history IDs and session-file paths
select durable owners and seed legacy context only on the first invocation.
Reset and successor generations do not reimport stale history. Slack binds its
workspace/user/scope identity; daemon, server and parent module factories carry
module-namespaced keys. Webhook source/agent owners and Vercel conversation IDs
recover across replacement; unrelated module work remains separate.

Four new integration cases exercise the production factories and Vercel route
with controlled model ports. They establish Slack replacement recall and current
instructions, workspace/user/scope isolation, daemon recovery beyond a stale
history snapshot, explicit reset, module isolation, unnamed-session preservation,
and request replacement by Vercel conversation ID. All 107 selected tests across
17 files passed. `pnpm check:fast` passed. The ordinary run summary and
`factory-continuity-*.log` retain the evidence. Authenticated provider recall and
launching-daemon restart remain unperformed operational observations. The targeted
task remains done.


## HTTP continuation and budget-error repair

Gemini budget errors now preserve their owned conversation identity. Direct
webhook and standalone HTTP chat recover persisted scoped owners after cache
replacement; public HTTP ids are durable even before the first message. Unknown
resume ids do not create new work. The new regressions reproduce both critic
findings with the defective behavior restored, then pass with the repair.
All 135 selected tests across 12 files and `pnpm check:fast` passed; the ordinary
summary and `http-budget-repair-*.log` files retain the proof. The socket-based
route suite could not finish because loopback listen returned EPERM; real route,
factory and persistence composition passed in-process. Authenticated recall and
launching-daemon restart remain unperformed. The targeted task remains done.

## Generated history ownership repair

New history entries persist their originating continuity key through the base
and semantic providers. Core-loop and CLI harness resume select that owner,
preserving checkpoints newer than the history snapshot and honoring reset.
Malformed stored bindings and conflicting explicit owners are rejected.

Both generated-history regressions first reproduced the critic's missing second
request, then passed for default and explicitly named owners without saving the
interrupted request to history. The harness test establishes shared lock rejection
and native identity recovery. All 98 selected tests across eight files and
`pnpm check:fast` passed. The ordinary summary and `history-owner-*.log` artifacts
retain proof and scope. Authenticated recall and launching-daemon restart remain
unperformed; the targeted task remains done.

## Interactive history lineage repair

Interactive CLI history resume now forwards its bound continuity owner. Both
harness history paths seed legacy context under the shared lock only before a
lineage exists, preserving newer checkpoints and honoring explicit resets.
Three regressions failed with the defective behavior restored; all 143 selected
tests and `pnpm check:fast` passed with the repair. The ordinary run summary and
`cli-history-repair-*.log` artifacts retain the evidence and unchanged live
validation limitations. The targeted task remains done.


## Canonical conversation file-access repair

The shared filesystem path guard now protects the runtime-supplied canonical
scope and the resolved conversation-store identity independently of the worktree.
Two real registered-tool regressions first disclosed synthetic private contents,
then passed for canonical paths, scope/store aliases, relative requests and
retired sibling transcripts while preserving ordinary file access.

The broader selection passed 180 tests; three path-containment cases and grep
suite cleanup encountered sandbox-denied fixture removal. The final two regression
cases and `pnpm check:fast` passed. The ordinary run summary and
`conversation-access-*.log` artifacts retain evidence and limitations.
Authenticated recall and launching-daemon restart remain unperformed. The targeted
task remains done.


## Recursive conversation-search repair

Registered grep now enumerates filenames, checks the shared resolved-path guard,
and searches only approved regular files with either ripgrep or the grep fallback.
The obsolete filename-only exclusion mechanism is removed. Resolved containment
also treats dot-prefixed child names correctly. Ordinary adjacent files, search
modes and aggregate counts remain available.

Three registered-tool cases reproduced private transcript disclosure before the
repair. All 96 selected filesystem and integration tests passed afterward,
including relocated stores, scope and file aliases, fallback execution and
multi-batch counts. `pnpm check:fast` passed. The ordinary run summary and
`recursive-search-*.log` artifacts retain proof. Authenticated provider recall
and launching-daemon restart remain unperformed; this task remains done.


## Execution sandbox protection repair

Shell, background processes and Python/Node REPLs now protect canonical and
workspace conversation directories through resolved aliases. Persistent REPL
reuse requires unchanged sandbox identity. Native adapters forward canonical
scope identity; Codex includes directory denials over narrower grants. Native
and task-probe Linux policies use private read-only directory mounts rather
than file masks; macOS denies recursive reads and writes.

All 135 selected regression tests passed, plus the native launch-policy case.
The live transcript/ordinary-file probe was attempted but nested sandbox-exec
was denied. A wider existing provider-egress case failed at loopback listen
with EPERM; three OS cases were skipped. Linux command generation is verified,
but Linux mount execution is unavailable on this macOS host. The ordinary run
summary and `conversation-sandbox-*.log` artifacts retain proof and limits.
Authenticated recall and launching-daemon restart remain unperformed; the task
remains done.


## Writable Linux workspace repair

Absent conversation masks now preserve effective writable workspace binds;
read-only ancestors still use private projections. Empty directory mountpoints
may be created beneath writable binds, while denied files remain private.
Regression policy checks cover existing canonical storage and absent package
storage without disabling file creation, deletion or atomic replacement.

The focused selection passed 37 tests; one existing loopback test hit EPERM and
five OS cases skipped, including two new Linux execution cases. `pnpm check:fast`
passed. The ordinary run summary records proof and limitations. Linux execution,
authenticated recovery and launching-daemon restart remain unperformed; this
task remains done.


## Unresolved native-stop repair

Failed native stop confirmation now persists exclusion for both logical owners
and native identities in the existing conversation lock store. Resume, explicit
discard, reset and another host cannot bypass it. Identity learned during drain
receives the same protection. Settlement rejects while stop remains unresolved;
confirmed stop still permits recovery even without an adapter result. Failed
attempt retirement cannot create a successor.

Two shared regressions first reproduced the critic's false settlement. The real
AGY adapter with a controlled process now rejects reuse after local exit without
remote terminal output. All 137 broader selected tests, all 15 final continuity
tests and `pnpm check:fast` passed. The ordinary summary and `native-stop-*.log` files retain proof.
Authenticated recall and launching-daemon restart remain unperformed operational
observations; the targeted task remains done.


## Unexpected native-exit repair

AGY exits without a terminal result now retain unresolved-stop exclusion regardless
of exit code, signal, parsing failure or caller cancellation. Core checks declared
native stop barriers on every settlement, including invocations without an abort
controller. Both logical owners and explicit native identities remain unavailable
for reuse and reset until remote stop is established.

Four new process-port regressions first reproduced unsafe release. All 77 selected
tests across six files passed after repair, including malformed output, confirmed
terminal success/cancellation, shared recovery and the Codex/Gemini CLI consumers.
`pnpm check:fast` passed. The ordinary summary and `native-exit-tests.log` retain
proof. Authenticated provider recall and launching-daemon restart remain unperformed;
the targeted task remains done.


## Native host-crash and prelaunch recovery repair

Native dispatch now persists pending-stop exclusion before entering the adapter.
Logical owners, known identities and identities learned during execution retain
that exclusion across abrupt host exit. Confirmed stop clears it; a replacement
host cannot infer provider settlement from a released OS lock. AGY distinguishes
proven validation, sandbox preparation and spawn failures from uncertain shutdown
after launch, preserving exact-identity recovery after environment repair.

Five regressions first reproduced both critic findings. The affected owner suites
passed 93 tests and the Claude shutdown/Telegram reset and REPL journeys passed
13 tests. Separate processes exercise crash exclusion before and after identity
checkpointing, resume/reset/discard rejection and independent conversation use.
Controlled real-adapter tests recover the same AGY identity after sandbox setup,
synchronous spawn and asynchronous spawn failures. Existing tests retain unsafe
exit rejection, confirmed-stop reuse, hosted crash recovery and cancellation.
Authenticated recall and launching-daemon restart remain unperformed operational
observations. The targeted task remains done.

Final `pnpm check:fast` passed, including production/test types, lint, task
validation and generated bindings (`native-crash-check-fast.log`). Changed-file
whitespace checks passed. Core harness guidance remains below the loader cap
at 7,902 bytes. The commit message is recorded for runtime-owned publication.

## Evidenced native-stop recovery and Codex prelaunch repair

Repair 14 adds the missing host-local operator recovery path. Each native attempt
binds its owner and native-identity exclusions to one execution id. After verifying
that local and provider work stopped, the operator supplies that exact id, explicit
confirmation and stop evidence to `kota history recover-native`. Core acquires all
matching locks and retains the evidence before clearing exclusions. Live ownership,
missing confirmation, empty evidence, wrong scope and stale execution ids reject
recovery. Recovery preserves conversation identity, transcripts and saved work.
Codex registers its stop barrier across validation, allowing a missing-model failure
to settle safely and a corrected invocation to launch.

The affected owner selection passed 84 tests across six files. The CLI recovery
journey passed, and `pnpm check:fast` passed. An independent controlled process/CLI
probe observed abrupt host exit, rejected premature resume and missing confirmation,
then recovered the same native identity and saved work with current instructions.
Its transcript and retained stop evidence live in the authorized run evidence
alongside the ordinary summary. These prove the operator path and retry behavior;
authenticated provider recall and launching-daemon restart remain unperformed.
The targeted task remains done.

## History resume command repair

Repair 15 forwards the saved continuity owner from `kota history resume` into
the harness REPL. Real CLI process regressions reproduced active-owner bypass
and loss of a checkpoint newer than history before the fix, then passed after it.
The recovery journey controls only provider HTTP, uses real persistence across
process replacement, and establishes legacy import, authentication-failure
preservation, recovery beyond a stale history projection, and explicit reset.
Both interactive CLI entry points now exercise original-owner lock rejection.
All 93 selected CLI, history and continuity tests and `pnpm check:fast` passed;
the ordinary run summary and `history-command-*.log` retain the proof.
Authenticated provider recall and launching-daemon restart remain unperformed
operational observations. The targeted task remains done.
