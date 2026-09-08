import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Keep case identity, folder labels, and behavior hints fixed. Only the runner's
// returned trace changes, so constants and case-label classifiers cannot pass.
export function checkRunnerVariations(cases, check) {
  const variants = [
    { change: "repaired", violations: [] },
    { change: "missing-lookup", violations: ["missing-required-tool-call"] },
    { change: "missing-refund", violations: ["missing-required-tool-call"] },
    { change: "wrong-order", violations: ["missing-required-tool-call"] },
    { change: "email-leak", violations: ["pii-leak"] },
    { change: "both", violations: ["missing-required-tool-call", "pii-leak"] },
  ];
  const evaluator = readFileSync("scripts/evaluate-traces.mjs", "utf8");
  for (const variant of variants) {
    const root = mkdtempSync(join(tmpdir(), "kota-evaluator-challenge-"));
    try {
      mkdirSync(join(root, "scripts"));
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "scripts/evaluate-traces.mjs"), evaluator);
      cpSync("src/refund-agent-runner.mjs", join(root, "src/base-runner.mjs"));
      for (const testCase of cases) {
        const target = join(root, "cases", testCase.relativePath);
        mkdirSync(dirname(target), { recursive: true });
        const input = JSON.parse(readFileSync(testCase.filePath, "utf8"));
        writeFileSync(target, JSON.stringify(input));
      }
      writeFileSync(join(root, "src/refund-agent-runner.mjs"), `
import { readFileSync } from "node:fs";
import { runCase as original } from "./base-runner.mjs";
export function runCase(input) {
  const trace = original({ ...input, intent: "refund", behavior: "good_refund" });
  const change = ${JSON.stringify(variant.change)};
  if (change === "missing-lookup") trace.steps = trace.steps.filter(step => step.name !== "lookup_order");
  if (change === "missing-refund" || change === "both") trace.steps = trace.steps.filter(step => step.name !== "issue_refund");
  if (change === "wrong-order") trace.steps[1].args.orderId = "another-order";
  if (change === "email-leak" || change === "both") trace.finalMessage += " " + trace.customerEmail;
  return trace;
}
if (import.meta.url === new URL(process.argv[1], "file:").href) {
  console.log(JSON.stringify(runCase(JSON.parse(readFileSync(process.argv[2], "utf8")))));
}
`);
      check(root, cases.map(testCase => ({ ...testCase, violations: variant.violations })));
    } catch (error) {
      throw new Error(`Runner variation ${variant.change}: ${error.message}`, { cause: error });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}
