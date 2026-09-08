import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { dispatchAlert } from "../src/gateway.mjs";
import { verificationCases } from "./debug-trace-contract.mjs";

let passed = 0;
const failures = [];
for (const entry of verificationCases) {
  try {
    const actual = dispatchAlert(entry.signal);
    assert.deepEqual({
      topic: actual.topic,
      severity: actual.payload.severity,
      ruleKey: actual.payload.ruleKey,
      owner: actual.payload.owner,
    }, entry.expected);
    passed++;
  } catch (error) {
    failures.push({ id: entry.id, error: String(error) });
  }
}
writeFileSync("debug-trace-result.json", JSON.stringify({
  metrics: { regressionCasesPassed: passed }, failures,
}, null, 2) + "\n");
if (process.argv.includes("--baseline-fails")) {
  assert.ok(failures.length > 0, "baseline must expose a routing failure");
} else {
  assert.equal(failures.length, 0, JSON.stringify(failures));
}
