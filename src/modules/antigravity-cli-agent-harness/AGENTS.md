# Antigravity CLI Agent Harness

This module owns KOTA's native adapter for Google's Antigravity CLI. Keep AGY
flags, event translation, login projection, readiness, and provider endpoints
inside this adapter rather than branching on the harness name elsewhere.

## Runtime Boundary

AGY owns its model tool loop, tool catalog, skills, plugins, MCP configuration,
and browser implementation. KOTA owns process cancellation, workspace mode,
machine-authority isolation, provider egress, and the non-interactive permission
disposition. The adapter rejects per-tool controls that cannot be enforced at
that process boundary.

Each run creates an invocation-local AGY project bound to the requested working
directory and consumes `stream-json`. KOTA's machine-authority sandbox is the
outer filesystem, process, and egress boundary. Because headless AGY cannot
service permission prompts, the adapter auto-approves AGY-native tools inside
that boundary and also enables AGY's terminal sandbox. Edit-capable runs use
`accept-edits`; read-only projections use `plan` with no writable scope.
Translate native events into
`KotaAgentMessage` frames here; preserve unknown frames as `raw` messages. KOTA
effort maps to AGY's `low`, `medium`, or `high` values, with stronger KOTA
levels capped at AGY's highest supported value.
Command-bearing tool events carry exact and prefix fingerprints for durable
adherence checks; raw command parameters remain provider tool I/O and must not
be persisted as trace text.

Interactive clients remain multi-turn through KOTA's transcript composition.
The adapter starts one isolated AGY process per turn. KOTA gives every native
invocation a fresh isolated home, so AGY conversation state is intentionally
not resumed across invocations. Repair iterations use fresh AGY projects and
receive prior results, critic findings, and the current worktree through
KOTA's durable handoff.

The CLI's own print timeout is only a final process cap. KOTA cancellation and
workflow idle supervision remain the normal lifecycle controls. Cancellation
sends a graceful signal to the isolated process group, then keeps the native
abort quarantine closed until AGY emits a terminal result for the remote
attempt and the local process settles. A local exit without that remote
terminal frame is an unconfirmed-stop failure, never permission to launch a
repair attempt.

Workflow `outputSchema` values pass through AGY's native `--json-schema`
surface; core still validates the normalized structured result. A terminal AGY
`SUCCESS` is transport success when AGY omits response text without an
unrecovered tool failure. A tool failure followed by an empty terminal success
is a harness error; workflow validators still decide whether otherwise
successful work satisfies the task. A missing terminal result is a transport
failure.

## Isolation

Daemon runs use an invocation-local home and ordinarily inherit no provider,
GitHub, notification, or cloud credentials. On macOS, project only the host's
encrypted `login.keychain-db` file read-only at the standard path inside that
home; never expose the whole Keychains directory or inspect the token. AGY owns
credential lookup and refresh. Its nested terminal sandbox prevents
auto-approved terminal tools from querying the host credential service, while
KOTA's outer sandbox remains authoritative for filesystem and egress access.
Provider-egress eval containers explicitly project only this adapter's declared
Google auth variables while the eval-owned upstream proxy marker is active.

The OS sandbox permits AGY's internal loopback listener, but outbound traffic
still goes only through KOTA's host-owned allowlisted proxy. In provider-egress
eval containers that proxy chains allowed CONNECT requests through the
eval-configured Docker-network proxy; it never opens a direct provider route.
Effective scope policy paths are projected into the run worktree before
launch; passive or write-confirmation runs can write only to invocation state.
Git metadata and machine authority remain protected.

## Model Routing

The shipped preset selects the strongest current AGY model and always passes an
explicit model and effort. The required local auth probe uses `agy models` to
verify that AGY can acquire credentials and access the requested catalog without
KOTA reading them. AGY owns credential lifetime and renewal. Do not infer
support from older Gemini CLI model catalogs. Catalog entries are
effort-qualified, so availability checks must match the requested model and
mapped AGY effort together.
