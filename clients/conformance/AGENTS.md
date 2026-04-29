# Thin-Client Contract Conformance

Pinned JSON fixtures every thin-client decoder is exercised against.

- `contract-fixture.json` is the canonical sample of the daemon's
  thin-client contract (`/identity`, `/capabilities`, `/workflow/definitions`,
  and the daemon error envelope). Both the TypeScript suite
  (`src/core/server/client-contract.test.ts`) and the macOS Swift test
  package (`clients/macos/Tests/.../ContractFixtureTests.swift`) parse
  this exact file so a payload drift fails decoders in every client at
  once.

- Add a new top-level field only after a corresponding daemon route or
  field exists. The fixture is a frozen contract, not a wishlist.

- When the contract grows, update this fixture in the same commit as the
  TypeScript and Swift decoders so the cross-client conformance test
  stays green.
