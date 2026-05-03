/**
 * Cross-client guard for the thin-client contract conformance gate.
 *
 * The canonical JSON tree lives at
 * `clients/conformance/contract-fixture.json` and the canonical TypeScript
 * decoders live at `clients/conformance/decoders.ts` and
 * `clients/conformance/decoders.test-cases.ts`. Each client target embeds a
 * byte-identical copy of the artifacts it consumes so its test runner can
 * resolve them locally without reaching outside its workspace:
 *
 * - Apple Swift suite —
 *   `clients/apple/Tests/KotaSharedTests/contract-fixture.json`
 *   (declared in `Package.swift` via `resources: [.copy(...)]`).
 * - Mobile Jest suite —
 *   `clients/mobile/src/__tests__/__fixtures__/{contract-fixture.json,
 *   decoders.ts, decoders.test-cases.ts}`. The TypeScript copies are kept
 *   in lockstep with the canonical files because Jest's expo babel
 *   transform cannot resolve helpers when transforming files outside the
 *   mobile workspace.
 *
 * This test asserts every client copy is byte-identical to its canonical
 * source. Any drift between them fails this guard, which keeps the
 * cross-client conformance promise honest without giving up the single
 * source of truth.
 *
 * The fixture itself is exercised by:
 * - `src/core/daemon/client-contract.test.ts` — TypeScript decoders.
 * - `clients/web/src/api/client.test.ts` — original thin-client surfaces.
 * - `clients/web/src/api/contractFixture.test.ts` — extended cross-store surfaces.
 * - `clients/mobile/src/__tests__/contractFixture.test.ts` — mobile surfaces.
 * - `ContractFixtureTests.swift` — macOS Swift Codable decoders.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CANONICAL_FIXTURE = resolve(
  __dirname,
  "../clients/conformance/contract-fixture.json",
);
const CANONICAL_DECODERS = resolve(
  __dirname,
  "../clients/conformance/decoders.ts",
);
const CANONICAL_CASES = resolve(
  __dirname,
  "../clients/conformance/decoders.test-cases.ts",
);
const SWIFT_FIXTURE_COPY = resolve(
  __dirname,
  "../clients/apple/Tests/KotaSharedTests/contract-fixture.json",
);
const MOBILE_FIXTURE_COPY = resolve(
  __dirname,
  "../clients/mobile/src/__tests__/__fixtures__/contract-fixture.json",
);
const MOBILE_DECODERS_COPY = resolve(
  __dirname,
  "../clients/mobile/src/__tests__/__fixtures__/decoders.ts",
);
const MOBILE_CASES_COPY = resolve(
  __dirname,
  "../clients/mobile/src/__tests__/__fixtures__/decoders.test-cases.ts",
);

function readJsonTree(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readBytes(path: string): string {
  return readFileSync(path, "utf8");
}

describe("contract fixture cross-client parity", () => {
  it("the macOS embedded fixture parses to the same JSON tree as the canonical file", () => {
    expect(readJsonTree(SWIFT_FIXTURE_COPY)).toEqual(
      readJsonTree(CANONICAL_FIXTURE),
    );
  });

  it("the mobile embedded fixture parses to the same JSON tree as the canonical file", () => {
    expect(readJsonTree(MOBILE_FIXTURE_COPY)).toEqual(
      readJsonTree(CANONICAL_FIXTURE),
    );
  });

  it("the mobile decoder copy is byte-identical to the canonical decoder", () => {
    expect(readBytes(MOBILE_DECODERS_COPY)).toBe(readBytes(CANONICAL_DECODERS));
  });

  it("the mobile decoder-cases copy is byte-identical to the canonical cases file", () => {
    expect(readBytes(MOBILE_CASES_COPY)).toBe(readBytes(CANONICAL_CASES));
  });
});
