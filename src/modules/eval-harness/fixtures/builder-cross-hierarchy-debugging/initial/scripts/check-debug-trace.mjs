#!/usr/bin/env node
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runBaselineFailureCheck,
  runMainCheck,
  runShortcutSelfTest,
} from "./debug-trace-runner.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifactPath = join(projectRoot, "debug-trace-result.json");

const args = process.argv.slice(2);

try {
  if (args.includes("--baseline-fails")) {
    runBaselineFailureCheck(projectRoot);
  } else if (args.includes("--self-test-shortcuts")) {
    runShortcutSelfTest(projectRoot);
  } else {
    runMainCheck(projectRoot, artifactPath);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
