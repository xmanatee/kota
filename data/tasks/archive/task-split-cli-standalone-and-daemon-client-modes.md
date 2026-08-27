---
status: done
---

# Split the CLI into standalone mode and daemon-client mode

## Problem

The CLI has no clear mode boundary today:

- some commands run a local session directly
- some commands inspect persisted state
- some commands conceptually want a live daemon but do not talk to one

That makes the CLI a fuzzy mix of runtime host, file inspector, and future
client.

## Desired Outcome

The CLI has two explicit execution modes:

- standalone local session mode
- daemon-client mode

Commands that need live daemon state or control use the daemon API instead of
reading `.kota/` files directly.

## Constraints

- Keep standalone `kota run` possible without requiring a daemon.
- Do not add parallel command trees for the same behavior.
- Prefer a small, explicit mode model over heuristics.

## Done When

- The CLI clearly distinguishes standalone local execution from daemon-backed
  client behavior.
- Live workflow/status/control commands use the daemon API when targeting a
  running daemon.
- File-based live-state probing is removed from CLI paths that should be
  daemon-backed.
- Help text and docs describe the two modes clearly.
