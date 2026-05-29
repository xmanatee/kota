import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProjectCode } from "../src/project-code.mjs";

// KOTA_FULL_CYCLE_VERIFICATION
test("normalizes punctuation and whitespace into stable project codes", () => {
  assert.equal(normalizeProjectCode("  North_Wind / 42 "), "north-wind-42");
  assert.equal(normalizeProjectCode("Alpha__BETA---99"), "alpha-beta-99");
});

test("rejects labels without letters or digits", () => {
  assert.throws(
    () => normalizeProjectCode("!!!"),
    /project code requires letters or digits/,
  );
});
