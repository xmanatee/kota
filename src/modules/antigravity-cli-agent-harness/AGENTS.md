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
single filesystem, process, and egress boundary. Because headless AGY cannot
service permission prompts, the adapter auto-approves AGY-native tools inside
that boundary instead of nesting AGY's terminal sandbox. Edit-capable runs use
`accept-edits`; read-only projections use `plan` with no writable scope.
Translate native events into
`KotaAgentMessage` frames here; preserve unknown frames as `raw` messages. KOTA
effort maps to AGY's `low`, `medium`, or `high` values, with stronger KOTA
levels capped at AGY's highest supported value.

Interactive clients remain multi-turn through KOTA's transcript composition;
the adapter still starts one isolated AGY process per turn and does not expose
AGY-native conversation resume as a KOTA session mechanism.

The CLI's own print timeout is only a final process cap. KOTA cancellation and
workflow idle supervision remain the normal lifecycle controls.

Workflow `outputSchema` values pass through AGY's native `--json-schema`
surface; core still validates the normalized structured result. A terminal AGY
`SUCCESS` is transport success when AGY omits response text without an
unrecovered tool failure. A tool failure followed by an empty terminal success
is a harness error; workflow validators still decide whether otherwise
successful work satisfies the task. A missing terminal result is a transport
failure.

## Isolation

Daemon runs use an invocation-local home and inherit no provider, GitHub,
notification, or cloud credentials. On macOS, the isolated home exposes only
the host Keychain directory through a read-only symlink so AGY can reuse its
native login without inheriting global settings, plugins, history, or caches.
Never copy or inspect the token itself.

The OS sandbox permits AGY's internal loopback listener, but outbound traffic
still goes only through KOTA's host-owned allowlisted proxy. Effective scope
policy paths are projected into the run worktree before launch; passive or
write-confirmation runs can write only to invocation state. Git metadata and
machine authority remain protected.

## Model Routing

The shipped preset selects current AGY model ids and always passes an explicit
model and effort. The required local auth probe uses `agy models`, which
verifies the cached login and current model access without reading credentials.
Treat that command as the local availability authority; do not infer support
from older Gemini CLI model catalogs.
