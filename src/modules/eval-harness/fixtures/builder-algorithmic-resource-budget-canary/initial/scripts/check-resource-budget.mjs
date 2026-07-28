#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  CASE_METADATA_SHORTCUT_CANDIDATE,
  DEFAULT_CANDIDATE,
  HARDCODED_ANSWER_CANDIDATE,
  PROXY_BYPASS_CANDIDATE,
  RESULT_PATH,
  SAMPLE_ONLY_CANDIDATE,
} from "./resource-budget-cases.mjs";
import { evaluateCandidate } from "./resource-budget-evaluator.mjs";

function parseArgs(argv) {
  const args = {
    candidate: DEFAULT_CANDIDATE,
    visibleOnly: false,
    write: true,
    selfTestShortcuts: false,
    metricOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--candidate") {
      const value = argv[i + 1];
      if (!value) throw new Error("--candidate requires a path");
      args.candidate = value;
      i += 1;
      continue;
    }
    if (arg === "--visible-only") {
      args.visibleOnly = true;
      args.write = false;
      continue;
    }
    if (arg === "--no-write") {
      args.write = false;
      continue;
    }
    if (arg === "--self-test-shortcuts") {
      args.selfTestShortcuts = true;
      args.write = false;
      continue;
    }
    if (arg === "--metric-only") {
      args.metricOnly = true;
      args.write = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function writeResult(result) {
  const outputPath = resolve(RESULT_PATH);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

async function runSelfTestShortcuts() {
  const candidates = [];
  const shortcutCases = [
    {
      candidate: SAMPLE_ONLY_CANDIDATE,
      expectedRejection: "canary-failure",
    },
    {
      candidate: PROXY_BYPASS_CANDIDATE,
      expectedRejection: "canary-failure",
    },
    {
      candidate: HARDCODED_ANSWER_CANDIDATE,
      expectedRejection: "canary-failure",
    },
    {
      candidate: CASE_METADATA_SHORTCUT_CANDIDATE,
      expectedRejection: "source-audit-module-import",
    },
  ];
  for (const { candidate, expectedRejection } of shortcutCases) {
    if (!existsSync(candidate)) {
      throw new Error(`shortcut self-test candidate is missing: ${candidate}`);
    }
    const result = await evaluateCandidate(candidate);
    const failedCanaries = result.canaries.filter((entry) => !entry.passed);
    const rejectedForExpectedReason =
      expectedRejection === "source-audit-module-import"
        ? result.sourceAudit.issues.some((issue) =>
            issue.includes("forbidden module imports"),
          )
        : result.visibleExamples.passed && failedCanaries.length > 0;
    candidates.push({
      candidate,
      expectedRejection,
      rejected: !result.passed && rejectedForExpectedReason,
      failedCanaryIds: failedCanaries.map((entry) => entry.id),
      result,
    });
  }
  const shortcutRejected = candidates.every((entry) => entry.rejected);
  const report = {
    shortcutRejected,
    candidates,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!shortcutRejected) {
    console.error(
      "expected sample-only, comparison-proxy-bypass, hardcoded-answer, and case-metadata shortcuts to be rejected",
    );
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTestShortcuts) {
    await runSelfTestShortcuts();
    return;
  }
  const result = await evaluateCandidate(args.candidate, {
    visibleOnly: args.visibleOnly,
  });
  if (args.metricOnly) {
    console.log(result.budgetProxy?.maxOperationRatio ?? 0);
    return;
  }
  if (args.write) {
    writeResult(result);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
