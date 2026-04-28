# Split large client protocol and state files

Source / intent: Broad daemon review on 2026-04-28 found several client files
that have become too large as seam fan-out accumulated.

Examples:

- `clients/mobile/src/daemonClient.ts` is over 1,200 lines.
- `clients/mobile/src/types.ts` is over 800 lines.
- `clients/macos/Sources/KotaMenuBar/Models.swift` is about 1,400 lines.
- `clients/macos/Sources/KotaMenuBar/DaemonClient.swift` is over 600 lines.

Desired outcome: Split these by capability namespace or protocol area while
keeping each client thin, strict, and daemon-backed. This should make future
capture/recall/answer/retract-style fan-out cheaper and less drift-prone.
