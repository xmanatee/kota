# Antigravity CLI Agent Harness

This module owns KOTA's native adapter for Google's Antigravity CLI. Keep AGY
flags, event translation, login projection, readiness, and provider endpoints
inside this adapter rather than branching on the harness name elsewhere.

## Runtime Boundary

AGY owns its model tool loop, skills, plugins, MCP configuration, browser use,
and native permission model. KOTA owns process cancellation, workspace mode,
machine-authority isolation, and provider egress. The adapter rejects KOTA tool
controls that cannot be enforced inside AGY.

Each run creates an invocation-local AGY project bound to the requested working
directory and consumes `stream-json`. Translate native events into
`KotaAgentMessage` frames here; preserve unknown frames as `raw` messages. KOTA
effort maps to AGY's `low`, `medium`, or `high` values, with stronger KOTA
levels capped at AGY's highest supported value.

Interactive clients remain multi-turn through KOTA's transcript composition;
the adapter still starts one isolated AGY process per turn and does not expose
AGY-native conversation resume as a KOTA session mechanism.

The CLI's own print timeout is only a final process cap. KOTA cancellation and
workflow idle supervision remain the normal lifecycle controls.

## Isolation

Daemon runs use an invocation-local home and inherit no provider, GitHub,
notification, or cloud credentials. On macOS, the isolated home exposes only
the host Keychain directory through a read-only symlink so AGY can reuse its
native login without inheriting global settings, plugins, history, or caches.
Never copy or inspect the token itself.

The OS sandbox permits AGY's internal loopback listener, but outbound traffic
still goes only through KOTA's host-owned allowlisted proxy. Passive runs can
write only to invocation state; autonomous runs can also write to the
workspace. Git metadata and machine authority remain protected.

## Model Routing

The shipped preset selects current AGY model ids and always passes an explicit
model and effort. The required local auth probe uses `agy models`, which
verifies the cached login and current model access without reading credentials.
Treat that command as the local availability authority; do not infer support
from older Gemini CLI model catalogs.
