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

function stagedMobilePaths() {
  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--", "clients/mobile"],
    { cwd: join(process.cwd(), "..", ".."), encoding: "utf8" },
  );
  if (result.status !== 0) return [];
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function run(command, args) {
  return spawnSync(command, args, { cwd: process.cwd(), stdio: "inherit" }).status ?? 1;
}

const missing = dependencyMarkers.filter((marker) => !existsSync(join(process.cwd(), marker)));
if (missing.length > 0) {
  const changedAppPaths = stagedMobilePaths().filter(
    (path) => !validationOnlyPaths.has(path),
  );
  if (changedAppPaths.length > 0) {
    console.error(
      "Mobile client dependencies are not installed; cannot typecheck staged mobile app changes.\n" +
        `Missing: ${missing.join(", ")}\n` +
        `Changed: ${changedAppPaths.join(", ")}`,
    );
    process.exit(1);
  }
  console.log("Mobile client dependencies are not installed; no staged mobile app changes require typecheck.");
  process.exit(0);
}

process.exit(run("pnpm", ["exec", "tsc", "--noEmit"]));
