/**
 * Fixture-scoped fake-binary shim for the autonomy eval harness.
 *
 * A shim is a tiny Node script that records each invocation of a shadowed
 * binary (today: `gh`) into a JSONL log under the fixture working directory.
 * Each fixture that opts in declares which binary names it shadows; the
 * runner installs an executable per name into `<workingDir>/.kota/shims/`
 * and prepends that directory to `PATH` for the subprocess. Production
 * code paths leave `PATH` untouched.
 *
 * The shim records argv exactly as observed; it never normalizes, re-quotes,
 * or interprets argv. Predicates own any matching tolerance they want to
 * express. The shim always exits 0 — a more elaborate fake (e.g. one that
 * fails certain commands) would itself be a second DSL the predicate kind
 * forbids.
 *
 * The shim derives its log path from its own __filename (shims live at
 * `<workingDir>/.kota/shims/<binary>`, log at
 * `<workingDir>/.kota/external-calls/<binary>.jsonl`), so there is no
 * env-var seam to drift between caller and shim.
 *
 * Replay-fixture compatibility: replay-mode runs apply recorded
 * `fileOperations` instead of executing tools, so a real shim invocation
 * never happens during replay. The recording's `fileOperations` writes
 * the same JSONL line shape the live shim would produce, so one
 * predicate evaluates either path. The shim mechanism is dormant but
 * installed during replay so a future live-LLM fixture for the same
 * workflow Just Works.
 */

import {
  chmodSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** Subdirectory inside the fixture working directory that holds shims. */
export const SHIM_SUBDIR = join(".kota", "shims");

/** Subdirectory inside the fixture working directory that holds the JSONL logs. */
export const EXTERNAL_CALL_LOG_SUBDIR = join(".kota", "external-calls");

/**
 * Source of the shim binary. The shim is intentionally a single
 * dependency-free Node script so it works in every fixture subprocess
 * without interpreter setup. It computes both the binary name and the log
 * path from its own __filename, so install-time wiring is just "drop the
 * file at the right path".
 */
const SHIM_SCRIPT = `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const scriptPath = require("node:url").fileURLToPath
  ? require("node:url").fileURLToPath(require("node:url").pathToFileURL(__filename))
  : __filename;
const binary = path.basename(scriptPath);
const shimsDir = path.dirname(scriptPath);
const kotaDir = path.dirname(shimsDir);
const logDir = path.join(kotaDir, "external-calls");
const logPath = path.join(logDir, binary + ".jsonl");

const argv = process.argv.slice(2);
const entry = {
  binary,
  argv,
  exitCode: 0,
  timestamp: new Date().toISOString(),
};

try {
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\\n");
} catch (err) {
  process.stderr.write(
    "[kota-eval-harness shim] failed to record " + binary + " invocation: " +
      (err && err.message ? err.message : String(err)) +
      "\\n",
  );
  process.exit(1);
}
process.exit(0);
`;

export type InstalledShims = {
  /** Absolute path to the shim directory (to prepend to PATH). */
  shimDir: string;
  /** Absolute path to the directory predicates read from. */
  logDir: string;
  /** Binary names that were installed. */
  binaries: readonly string[];
};

const VALID_BINARY_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Install one shim per declared binary name into the fixture working
 * directory. Returns the shim and log directories so callers can wire
 * them into the subprocess environment. Idempotent: re-running overwrites
 * existing shims.
 */
export function installExternalCallShims(
  workingDir: string,
  binaries: readonly string[],
): InstalledShims {
  const shimDir = join(workingDir, SHIM_SUBDIR);
  const logDir = join(workingDir, EXTERNAL_CALL_LOG_SUBDIR);
  mkdirSync(shimDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });
  for (const binary of binaries) {
    if (!VALID_BINARY_NAME.test(binary)) {
      throw new Error(
        `external-call shim binary name ${JSON.stringify(binary)} contains characters outside [A-Za-z0-9._-]; refuse to install a shim with that name.`,
      );
    }
    const shimPath = join(shimDir, binary);
    writeFileSync(shimPath, SHIM_SCRIPT, "utf-8");
    chmodSync(shimPath, 0o755);
  }
  return { shimDir, logDir, binaries: [...binaries] };
}
