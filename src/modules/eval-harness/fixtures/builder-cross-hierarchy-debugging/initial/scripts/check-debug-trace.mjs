#!/usr/bin/env node
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runBaselineFailureCheck,
  runMainCheck,
  runShortcutSelfTest,
} from "./debug-trace-runner.mjs";

const scopeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifactPath = join(scopeRoot, "debug-trace-result.json");

const args = process.argv.slice(2);

try {
  if (args.includes("--baseline-fails")) {
    runBaselineFailureCheck(scopeRoot);
  } else if (args.includes("--self-test-shortcuts")) {
    runShortcutSelfTest(scopeRoot);
  } else {
    runMainCheck(scopeRoot, artifactPath);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
