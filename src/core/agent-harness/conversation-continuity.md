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
Recoverable work never expires. Invocations rebuild instructions, credentials and
permissions. Recovery never replays effects or restores instruction pointers.
Conversation storage excludes agent access, workspace diffs and runtime staging.
