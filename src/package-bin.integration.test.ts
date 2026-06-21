import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const BIN_PATH = join(REPO_ROOT, "bin", "kota.mjs");
const CLI_PATH = join(REPO_ROOT, "dist", "cli.js");
const HELP_ARGS = ["task", "--help"];
const TIMEOUT_MS = 30_000;

beforeAll(() => {
  if (!existsSync(CLI_PATH)) {
    throw new Error(
      `dist/cli.js missing at ${CLI_PATH}. Run \`pnpm build\` before \`pnpm test\`. ` +
        "The package-bin smoke intentionally covers the shipped launcher.",
    );
  }
});

function runPackageBin(nodeOptions: string | undefined): {
  stdout: string;
  stderr: string;
  status: number | null;
} {
  const env = { ...process.env };
  if (nodeOptions === undefined) {
    delete env.NODE_OPTIONS;
  } else {
    env.NODE_OPTIONS = nodeOptions;
  }

  const result = spawnSync(process.execPath, [BIN_PATH, ...HELP_ARGS], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env,
    timeout: TIMEOUT_MS,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  };
}

describe("package bin", () => {
  it("loads built dist when NODE_OPTIONS contains the source condition", () => {
    const result = runPackageBin(
      "--conditions=source --max-old-space-size=4096",
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("kota task");
  });

  it("still loads built dist without NODE_OPTIONS", () => {
    const result = runPackageBin(undefined);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("kota task");
  });
});
