/**
 * Cross-client guard for the thin-client contract conformance fixture.
 *
 * The canonical JSON tree lives at
 * `clients/conformance/contract-fixture.json`. The macOS Swift suite
 * embeds the same tree as a string literal inside
 * `clients/macos/Tests/KotaMenuBarTests/ContractFixtureTests.swift` so
 * SwiftPM does not need to reach outside its target for resources.
 *
 * This test extracts the Swift literal, parses both blobs as JSON, and
 * asserts the trees match. Any drift between the canonical fixture and
 * the embedded macOS copy fails this guard, which keeps the cross-
 * client conformance promise honest without giving up the single source
 * of truth.
 *
 * The fixture itself is exercised by:
 * - `src/core/daemon/client-contract.test.ts` — TypeScript decoders.
 * - `clients/web/src/api/client.test.ts` — web client decoders.
 * - `ContractFixtureTests.swift` — macOS Swift Codable decoders.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CANONICAL = resolve(
  __dirname,
  "../clients/conformance/contract-fixture.json",
);
const SWIFT_TEST = resolve(
  __dirname,
  "../clients/macos/Tests/KotaMenuBarTests/ContractFixtureTests.swift",
);

/**
 * Extract the multi-line string literal Swift assigns to
 * `fixtureJSON`. The literal is delimited by `"""` on its own line at
 * the open and close so this regex is unambiguous.
 */
function extractSwiftFixtureLiteral(source: string): string {
  const match = source.match(
    /private static let fixtureJSON = """\n([\s\S]+?)\n"""/,
  );
  if (!match || match[1] === undefined) {
    throw new Error(
      "Could not locate the Swift fixtureJSON literal — has the test file changed?",
    );
  }
  return match[1];
}

describe("contract fixture cross-client parity", () => {
  it("the macOS embedded fixture parses to the same JSON tree as the canonical file", () => {
    const canonical = JSON.parse(readFileSync(CANONICAL, "utf8"));
    const swiftSource = readFileSync(SWIFT_TEST, "utf8");
    const swiftLiteral = extractSwiftFixtureLiteral(swiftSource);
    const swiftTree = JSON.parse(swiftLiteral);
    expect(swiftTree).toEqual(canonical);
  });
});
