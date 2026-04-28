# Share or generate daemon wire contracts for clients

Source / intent: Broad daemon review on 2026-04-28 found strong client test
coverage, but web, mobile, and macOS all hand-maintain daemon response
types/decoders.

Problem:

- `clients/web/src/api/types.ts`
- `clients/mobile/src/daemonClient.ts` and `clients/mobile/src/types.ts`
- `clients/macos/Sources/KotaMenuBar/Models.swift`

all mirror daemon protocol shapes manually. Tests catch drift after the fact,
but the contract is not robust by construction.

Desired outcome: Define one durable way to share, generate, or conformance-test
daemon wire contracts across web, mobile, and macOS. Preserve strict decoding
and typed failure arms. Do not add a second public API surface.
