import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dependencyMarkers = [
  "node_modules/.bin/tsc",
  "node_modules/expo/tsconfig.base.json",
  "node_modules/react/package.json",
  "node_modules/react-native/package.json",
  "node_modules/@types/react/package.json",
  "node_modules/@types/jest/package.json",
];

const validationOnlyPaths = new Set([
  "clients/mobile/package.json",
  "clients/mobile/scripts/typecheck.mjs",
]);

const logger = {
  info(message, fields) {
    writeLog("info", message, fields);
  },
  warn(message, fields) {
    writeLog("warn", message, fields);
  },
  error(message, fields) {
    writeLog("error", message, fields);
  },
};

function writeLog(level, message, fields) {
  process.stderr.write(
    `${JSON.stringify({
      source: "kota-mobile-typecheck",
      level,
      message,
      ...fields,
    })}\n`,
  );
}

function stagedMobilePaths() {
  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--", "clients/mobile"],
    { cwd: join(process.cwd(), "..", ".."), encoding: "utf8" },
  );
  if (result.status !== 0) {
    return {
      paths: [],
      error: {
        exitCode: result.status ?? 1,
        signal: result.signal ?? null,
        stderr: result.stderr.trim(),
      },
    };
  }
  return {
    paths: result.stdout.split("\n").map((line) => line.trim()).filter(Boolean),
    error: null,
  };
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: process.cwd(), stdio: "inherit" });
  return {
    exitCode: result.status ?? 1,
    signal: result.signal ?? null,
    error: result.error?.message ?? null,
  };
}

const missing = dependencyMarkers.filter((marker) => !existsSync(join(process.cwd(), marker)));
if (missing.length > 0) {
  const staged = stagedMobilePaths();
  if (staged.error) {
    logger.error("Mobile typecheck could not inspect staged mobile changes.", {
      status: "failed",
      missing,
      gitDiff: staged.error,
    });
    console.error(
      "Mobile client dependencies are not installed and staged mobile changes could not be inspected.\n" +
        `Missing: ${missing.join(", ")}\n` +
        `git diff exit: ${staged.error.exitCode}`,
    );
    process.exit(1);
  }

  const changedAppPaths = staged.paths.filter(
    (path) => !validationOnlyPaths.has(path),
  );
  if (changedAppPaths.length > 0) {
    logger.error("Mobile typecheck cannot run because dependencies are missing.", {
      status: "failed",
      missing,
      changedAppPaths,
    });
    console.error(
      "Mobile client dependencies are not installed; cannot typecheck staged mobile app changes.\n" +
        `Missing: ${missing.join(", ")}\n` +
        `Changed: ${changedAppPaths.join(", ")}`,
    );
    process.exit(1);
  }
  logger.warn("Mobile typecheck skipped because no staged mobile app paths require it.", {
    status: "skipped",
    missing,
    changedAppPaths,
  });
  console.log("Mobile client dependencies are not installed; no staged mobile app changes require typecheck.");
  process.exit(0);
}

logger.info("Mobile typecheck running TypeScript compiler.", {
  status: "running",
  command: "pnpm exec tsc --noEmit",
});
const result = run("pnpm", ["exec", "tsc", "--noEmit"]);
logger[result.exitCode === 0 ? "info" : "error"]("Mobile typecheck completed.", {
  status: result.exitCode === 0 ? "passed" : "failed",
  exitCode: result.exitCode,
  signal: result.signal,
  error: result.error,
});
process.exit(result.exitCode);
