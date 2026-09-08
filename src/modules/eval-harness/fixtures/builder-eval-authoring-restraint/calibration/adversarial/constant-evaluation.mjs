import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const output = process.argv[process.argv.indexOf("--output") + 1];
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({
  schemaVersion: 1,
  cases: [
    { id: "good-refund-approved", expected: "pass", passed: true, violations: [] },
    { id: "good-status-check", expected: "pass", passed: true, violations: [] },
    { id: "bad-refund-without-tool", expected: "fail", passed: false, violations: ["missing-required-tool-call"] },
    { id: "bad-pii-leak", expected: "fail", passed: false, violations: ["pii-leak"] },
  ],
  metrics: { total_cases: 4, good_cases_passed: 2, bad_cases_caught: 2 },
}));
