/**
 * Web client conformance gate.
 *
 * Decodes every entry in `clients/conformance/decoders.test-cases.ts` against
 * the canonical `clients/conformance/contract-fixture.json`. Negative cases
 * are exercised by asserting the decoder throws on unknown discriminator
 * values; positive cases additionally run the case's `assertPositive` hook
 * when present.
 *
 * The macOS Swift suite (`ContractFixtureTests.swift`) and the mobile Jest
 * suite (`clients/mobile/src/__tests__/contractFixture.test.ts`) exercise
 * the same canonical fixture through their own typed decoders, so any
 * payload drift fails every suite together.
 */

import { describe, expect, it } from "vitest";
import fixture from "../../../conformance/contract-fixture.json";
import {
  CONFORMANCE_CASES,
  readFixturePath,
} from "../../../conformance/decoders.test-cases";

describe("web client — thin-client contract conformance fixtures", () => {
  for (const testCase of CONFORMANCE_CASES) {
    if (testCase.expectThrow) {
      it(`rejects ${testCase.name}`, () => {
        const subtree = readFixturePath(fixture, testCase.path);
        expect(() => testCase.parse(subtree)).toThrow();
      });
    } else {
      it(`decodes ${testCase.name}`, () => {
        const subtree = readFixturePath(fixture, testCase.path);
        const decoded = testCase.parse(subtree);
        expect(decoded).toBeDefined();
        testCase.assertPositive?.(decoded);
      });
    }
  }
});
