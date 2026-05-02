/**
 * Mobile client conformance gate.
 *
 * Decodes every entry in `clients/conformance/decoders.test-cases.ts`
 * against the canonical `clients/conformance/contract-fixture.json` (read
 * via the embedded resource copy under
 * `clients/mobile/src/__tests__/__fixtures__/contract-fixture.json` so
 * Jest does not need to reach outside the mobile workspace at runtime).
 *
 * The cross-client integration test
 * (`src/contract-fixture-cross-client.integration.test.ts`) keeps the
 * embedded copy byte-identical to the canonical file. The macOS Swift
 * suite (`ContractFixtureTests.swift`) and the web Vitest suite
 * (`clients/web/src/api/contractFixture.test.ts`) exercise the same
 * canonical fixture through their own typed decoders, so any payload
 * drift fails every suite together.
 */

import fixture from './__fixtures__/contract-fixture.json';
import {
  CONFORMANCE_CASES,
  readFixturePath,
} from './__fixtures__/decoders.test-cases';

describe('mobile client — thin-client contract conformance fixtures', () => {
  for (const testCase of CONFORMANCE_CASES) {
    if (testCase.expectThrow) {
      test(`rejects ${testCase.name}`, () => {
        const subtree = readFixturePath(fixture, testCase.path);
        expect(() => testCase.parse(subtree)).toThrow();
      });
    } else {
      test(`decodes ${testCase.name}`, () => {
        const subtree = readFixturePath(fixture, testCase.path);
        const decoded = testCase.parse(subtree);
        expect(decoded).toBeDefined();
        testCase.assertPositive?.(decoded);
      });
    }
  }
});
