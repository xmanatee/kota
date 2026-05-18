import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = join(import.meta.dirname, "..");
const PACKAGE_JSON = join(PROJECT_ROOT, "package.json");
const WORKSPACE_CONFIG = join(PROJECT_ROOT, "pnpm-workspace.yaml");
const LOCKFILE = join(PROJECT_ROOT, "pnpm-lock.yaml");

const REQUIRED_PNPM_VERSION = "10.26.0";
const REQUIRED_POLICY = {
  "minimum-release-age": 1440,
  "block-exotic-subdeps": true,
  "trust-policy": "no-downgrade",
  "strict-dep-builds": false,
  "dangerously-allow-all-builds": false,
} as const;

const DENIED_BUILDS = [
  { packageName: "@google/genai", lockfileSelector: "@google/genai@1.51.0" },
  { packageName: "esbuild", lockfileSelector: "esbuild@0.27.4" },
  { packageName: "protobufjs", lockfileSelector: "protobufjs@7.5.5" },
] as const;

type PackageJson = {
  packageManager?: string;
};

function compareSemver(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10));
  const right = b.split(".").map((part) => Number.parseInt(part, 10));

  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pinnedPnpmVersion(): string {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf-8")) as PackageJson;
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager ?? "");
  if (!match) {
    throw new Error("packageManager must pin an exact pnpm version");
  }
  return match[1];
}

function readPnpmProjectConfig(): Record<string, unknown> {
  const output = execFileSync(
    "pnpm",
    ["config", "list", "--location", "project", "--json"],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
    },
  );
  return JSON.parse(output) as Record<string, unknown>;
}

describe("pnpm supply-chain policy", () => {
  it("pins a pnpm version new enough for the committed safeguards", () => {
    expect(
      compareSemver(pinnedPnpmVersion(), REQUIRED_PNPM_VERSION),
    ).toBeGreaterThanOrEqual(0);
  });

  it("enforces release age, exotic dependency blocking, trust checks, and explicit build policy", () => {
    const config = readPnpmProjectConfig();

    for (const [key, value] of Object.entries(REQUIRED_POLICY)) {
      expect(config[key]).toEqual(value);
    }

    expect(config["ignored-built-dependencies"]).toEqual(
      DENIED_BUILDS.map((entry) => entry.packageName),
    );
  });

  it("keeps build-script denials named and tied to the current lockfile", () => {
    const workspaceConfig = readFileSync(WORKSPACE_CONFIG, "utf-8");
    const lockfile = readFileSync(LOCKFILE, "utf-8");

    expect(workspaceConfig).toContain("allowBuilds:");
    expect(workspaceConfig).toContain("pnpm 10.32.1 still exits nonzero");
    for (const entry of DENIED_BUILDS) {
      expect(workspaceConfig).toContain(`${entry.lockfileSelector} `);
      expect(workspaceConfig).toContain(`"${entry.packageName}": false`);
      expect(lockfile).toMatch(
        new RegExp(`\\n  '?${escapeRegExp(entry.lockfileSelector)}'?:`),
      );
    }
  });
});
