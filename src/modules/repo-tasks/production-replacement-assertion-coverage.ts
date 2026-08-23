import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { vitestRepoPath } from "./production-replacement-vitest-paths.js";

const VITEST_CONFIG_NAMES = [
  "vitest.config.ts",
  "vitest.config.mts",
  "vitest.config.cts",
  "vitest.config.js",
  "vitest.config.mjs",
  "vitest.config.cjs",
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.cts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
] as const;

type InspectorCoverageReport = {
  schemaVersion?: number;
  result?: Array<{
    url?: string;
    functions?: Array<{
      ranges?: Array<{
        startOffset?: number;
        endOffset?: number;
        count?: number;
      }>;
    }>;
  }>;
} | null;

export type AssertionCoverageHarness = {
  configFile: string;
  observationFile: string;
};

function findOriginalVitestConfig(projectDir: string): string | null {
  for (const name of VITEST_CONFIG_NAMES) {
    const candidate = join(projectDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function observerSource(observationFile: string): string {
  return `import { writeFileSync } from "node:fs";
import inspector from "node:inspector";
import { afterEach, beforeEach } from "vitest";

let session;

function post(method, params) {
  return new Promise((resolve, reject) => {
    session.post(method, params ?? {}, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

beforeEach(async () => {
  session = new inspector.Session();
  session.connect();
  await post("Profiler.enable");
  await post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
});

afterEach(async () => {
  try {
    const coverage = await post("Profiler.takePreciseCoverage");
    writeFileSync(${JSON.stringify(observationFile)}, JSON.stringify({
      schemaVersion: 1,
      result: coverage.result,
    }), { flag: "wx", mode: 0o600 });
  } finally {
    await post("Profiler.stopPreciseCoverage");
    await post("Profiler.disable");
    session.disconnect();
  }
});
`;
}

function configSource(originalConfig: string | null, observerFile: string): string {
  const originalImport = originalConfig === null
    ? "const originalConfig = {};"
    : `import originalConfig from ${JSON.stringify(pathToFileURL(originalConfig).href)};`;
  return `${originalImport}

export default async function assertionCoverageConfig(environment) {
  const resolvedConfig = typeof originalConfig === "function"
    ? await originalConfig(environment)
    : await originalConfig;
  if (resolvedConfig === null || typeof resolvedConfig !== "object" || Array.isArray(resolvedConfig)) {
    throw new Error("Vitest config must resolve to an object before assertion coverage can be installed");
  }
  const testConfig = resolvedConfig.test === undefined ? {} : resolvedConfig.test;
  if (testConfig === null || typeof testConfig !== "object" || Array.isArray(testConfig)) {
    throw new Error("Vitest test config must be an object before assertion coverage can be installed");
  }
  const configuredSetup = testConfig.setupFiles;
  const setupFiles = configuredSetup === undefined
    ? []
    : Array.isArray(configuredSetup)
      ? configuredSetup
      : [configuredSetup];
  return {
    ...resolvedConfig,
    test: {
      ...testConfig,
      setupFiles: [...setupFiles, ${JSON.stringify(observerFile)}],
    },
  };
}
`;
}

export function writeAssertionCoverageHarness(args: {
  projectDir: string;
  executionDir: string;
  index: number;
}): AssertionCoverageHarness {
  const observationFile = join(args.executionDir, `assertion-${args.index}-coverage.json`);
  const observerFile = join(args.executionDir, `assertion-${args.index}-observer.mjs`);
  const configFile = join(args.executionDir, `assertion-${args.index}-vitest.config.mjs`);
  writeFileSync(observerFile, observerSource(observationFile), { mode: 0o600 });
  writeFileSync(
    configFile,
    configSource(findOriginalVitestConfig(args.projectDir), observerFile),
    { mode: 0o600 },
  );
  return { configFile, observationFile };
}

export function readAssertionCoveragePaths(args: {
  projectDir: string;
  observationFile: string;
}): { ok: true; paths: Set<string> } | { ok: false; error: string } {
  let report: InspectorCoverageReport;
  try {
    report = JSON.parse(readFileSync(args.observationFile, "utf-8")) as InspectorCoverageReport;
  } catch (error) {
    return {
      ok: false,
      error: `assertion-scoped runtime coverage is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (
    report === null ||
    report.schemaVersion !== 1 ||
    !Array.isArray(report.result)
  ) {
    return { ok: false, error: "assertion-scoped runtime coverage is malformed" };
  }
  const paths = new Set<string>();
  for (const script of report.result) {
    if (typeof script.url !== "string" || !Array.isArray(script.functions)) {
      return { ok: false, error: "assertion-scoped runtime coverage contains a malformed script" };
    }
    const executed = script.functions.some((fn) =>
      Array.isArray(fn.ranges) && fn.ranges.some((range) =>
        typeof range.startOffset === "number" &&
        typeof range.endOffset === "number" &&
        range.endOffset > range.startOffset &&
        typeof range.count === "number" &&
        range.count > 0
      )
    );
    if (!executed) continue;
    const repoPath = vitestRepoPath(args.projectDir, script.url);
    if (repoPath !== null) paths.add(repoPath);
  }
  return { ok: true, paths };
}
