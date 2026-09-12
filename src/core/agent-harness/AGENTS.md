# Agent Harness Protocol

Core owns the harness protocol, registry, and conversation continuity.
Adapters live in modules.

## Protocol

- Reject unsupported options at the adapter boundary; never silently coerce them.
- `AgentHarnessRunOptions.systemPrompt` is portable text composed by
  `buildKotaSystemPrompt` in `src/core/loop/`. Only adapters wrap it in
  provider-native envelopes.
- Neutral options carry tool risk, live scope policy, commit/daemon guards, and
  injection defense (`scopePolicy`, `getScopePolicySnapshot`, `canUseTool`, MCP
  and tool lists). KOTA-routable loops must honor them; other adapters declare
  them in `unsupportedRunOptions`, so `runAgentHarness` rejects them before
  hooks or launch.
- Harnesses enforce `AgentDef.writeScope` before scope mutation; Git checks
  backstop it. Workflow agents receive one separately propagated per-run output
  directory, never the canonical run directory containing runtime state.
- Nested handoffs and delegates are authorization boundaries: carry both
  policy options; inherited tool lists and `canUseTool` are insufficient.
- `sessionContext` is tool-runtime identity, not workflow trace/span metadata.
  `runAgentHarness` creates one per invocation; persistent interactive callers
  register one outer lifetime and reuse its context through teardown.
- `runAgentHarness` rejects late output after abort/settlement; identity checkpoints
  remain valid during adapter ownership. Native stop barriers run on cancellation
  and ordinary settlement, including calls without an abort controller. Native and
  nested launches use `createNativeAgentInvalidationLifecycle` for abort propagation,
  restrictive policy, and idempotent cleanup.
- `guards.ts` owns hidden agent/worktree nesting, commit, daemon-control, and
  authority guards. Its OS sandbox gives opaque code and native CLIs minimal
  environments, isolated home/temp, scope package-manager runtimes,
  declared auth/read roots, and provider-only egress through a host-owned proxy.
  Native tools lack direct host, loopback, metadata-service, or internet routes.
  KOTA native sandboxes protect `.kota`; only validated `KOTA_RUN_DIR` /
  `KOTA_RUN_TEMP_DIR` evidence and temp paths are writable. Native writer task
  authorization crosses a per-invocation, runtime-owned request/reply boundary:
  only its request directory is additionally writable; responses are read-only.
  Raw daemon databases and SQLite journals never cross the agent read boundary.
  Every native invocation derives those denials from host-owned open database
  locators, including custom state roots, independently of writer authorization.
  Conventional invocation/host state roots remain protected without an open store.
  Linux read denials cover every mounted surface, including writable roots and
  runtime write boundaries that have no explicit read grant.
  File-denied directories use private, read-only Linux namespace projections:
  existing permitted entries retain their effective mounts, while future host
  entries stay invisible. Journal masking never creates host SQLite files.
  Absent mask mountpoints beneath read-only binds require a private projection
  of their existing ancestor before the mask is installed. Writable ancestors
  stay host-bound so workspace creates, deletes and atomic replacements persist;
  Bubblewrap may create empty directory mountpoints there, while denied files
  and journals are created only inside private projections.
- Dependency discovery grants only physical `node_modules` locations along the
  canonical workspace ancestry. Scope-controlled links cannot authorize their
  targets; external package stores require explicit runtime read grants.
- Native CLI adapters compose their workflow Git and daemon instructions from
  the shared native workflow rails. Keep Git metadata read-only for agents and
  leave staging, rebase continuation, commits, and publication runtime-owned.
- Runtime Probes and production proofs use the fail-closed contained-workspace sandbox; never add an unsandboxed launcher.

## Capability admission

Capability snapshots derive from adapter declarations, never name catalogs.
Reject incompatible requests before hooks or launch. Readiness probes stay
host-local; definition validation stays host-independent. Unattended preclaim
requires proof of renewable access.

Runtime protects native machine-authority paths and aliases before sandbox
selection; overlapping grants cannot widen them. Hosted loops refresh policy
per call; native loops abort on stricter revisions. Login locators carry no tokens.

`modelRouting` opts adapters into provider-owned matrix admission. Native routes
receive native model ids; ModelClient routes retain provider qualification.
The provider owner resolves declarations and invokes model validation before
launch. Missing declarations cannot establish compatibility.

## Registration and adapter contracts

Modules contribute adapters through `KotaModule.agentHarnesses`; registration
returns an exact disposer. Imports never register adapters. Resolution rejects
unknown names without a fallback. Steps inherit the configured harness unless
explicitly pinned; repair judges use the parent step's resolved harness.

Modules register neutral hooks through `ctx.registerHarnessHook`; dispatch
rejects undeclared kinds. Cross-adapter decoration uses these hooks.
`message-codec.ts` decodes durable/foreign messages. SDK formats and MCP hosting
stay in adapters. Translate permissions and MCP transports or reject them;
tool schemas admit JSON-compatible open JSON Schema envelopes.
Provider knobs use validated `harnessOverrides`; workflow `harnessOptions` names
only the resolved harness. Keep adapter knobs off neutral workflow steps.

## Conversation continuity

Harness and ModelClient sessions preserve by default. `continuityKey` identifies
work; tasks, roles and child calls stay distinct.
History resume uses its bound owner; unbound legacy sources seed their own owners.
Unnamed core-loop sessions use unique session ids. Legacy context seeds only new
lineages, never reset or successor generations. Checkpoints survive disabled
history; native ids persist before completion under the canonical scope, outside
disposable worktrees and process homes.
Runtime admission owns workflow concurrency; the harness rejects simultaneous
use of one conversation across hosting processes, including CLI resumes and
resets. OS-backed conversation locks release on process death and remain held
through native-session recovery. Native dispatch first durably fences the logical
owner and known native identities; newly checkpointed identities inherit it. Only
confirmed settlement clears the fence, so abrupt host exit cannot admit reuse.
Failed stop confirmation retains it, including identities learned during drain.
`kota history recover-native` records operator stop evidence for one execution
before clearing its fences; live owners and later executions stay protected. Hosted
cancellation closes output but retains ownership until shutdown and transcript
writes settle. The returned promise exposes `settled` for owners that
must await that release before reset or replacement; unresolved native stop
rejects settlement. Explicit transfers resolve only the named identity in
the same scope; unrelated malformed checkpoints cannot prevent that lookup.

Adapters own native transcripts or opaque SDK message formats. Core owns neutral
reconstruction, identity lineage, and one successor attempt after proven session
loss. Authentication, quota, and transport failures preserve the identity. A reset
or unsupported capability records its reason; retirement retains original state.
Recoverable work never expires automatically. Every invocation rebuilds current
instructions, credentials and permissions. Recovery never replays pending effects
or restores a process instruction pointer. Conversation storage is excluded from
agent access, workspace diffs and runtime staging.
