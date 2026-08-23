import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  type AvailableContainedWorkspaceSandbox,
  resolveContainedWorkspaceSandbox,
} from "#core/agent-harness/task-probe-sandbox.js";
import { buildRequiredInheritedSubprocessEnv } from "#core/modules/subprocess-env.js";
import type { ProductionReplacementArtifact } from "./production-replacement-evidence.js";
import type { ProductionReplacementDeclaration } from "./production-replacement-proof.js";
import {
  collectTransformedRepoPaths,
  vitestRepoPath,
} from "./production-replacement-vitest-paths.js";

type VitestJsonReport = {
  success: boolean;
  testResults: Array<{
    name: string;
    status: string;
    assertionResults: Array<{
      fullName: string;
      status: string;
    }>;
  }>;
};

type VitestExecution =
  | {
    ok: true;
    report: VitestJsonReport;
    transformedPaths: Set<string>;
  }
  | { ok: false; error: string };

function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((value) => expected.includes(value));
}

function executeVitest(args: {
  projectDir: string;
  testArgs: string[];
  runtimeHome: string;
  sandbox: AvailableContainedWorkspaceSandbox;
}): VitestExecution {
  const launch = buildProductionReplacementVitestLaunch(
    args.sandbox,
    args.testArgs,
  );
  const execution = spawnSync(
    launch.command,
    launch.args,
    {
      cwd: args.projectDir,
      encoding: "utf-8",
      env: buildProductionReplacementTestEnvironment(args.runtimeHome),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (execution.error || execution.status !== 0) {
    const detail = [
      execution.error?.message ?? "",
      execution.stderr,
      execution.stdout,
    ].filter((value) => value.length > 0).join("\n").trim();
    return {
      ok: false,
      error: `declared production tests failed: ${
        detail.slice(-20_000) || `exit ${execution.status ?? "unknown"}`
      }`,
    };
  }
  try {
    return {
      ok: true,
      report: JSON.parse(execution.stdout) as VitestJsonReport,
      transformedPaths: collectTransformedRepoPaths(args.projectDir, execution.stderr),
    };
  } catch (error) {
    return {
      ok: false,
      error: `declared production test report is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function buildProductionReplacementTestEnvironment(
  runtimeHome: string,
  inheritedEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...buildRequiredInheritedSubprocessEnv(inheritedEnv),
    HOME: runtimeHome,
    TMPDIR: runtimeHome,
    NO_COLOR: "1",
    DEBUG: "vite:transform",
    NODE_OPTIONS: "--conditions=source",
  };
}

export function buildProductionReplacementVitestLaunch(
  sandbox: AvailableContainedWorkspaceSandbox,
  testArgs: readonly string[],
): { command: string; args: string[] } {
  return {
    command: sandbox.command,
    args: [
      ...sandbox.prefixArgs,
      sandbox.probeExecutable,
      "exec",
      "vitest",
      "run",
      ...testArgs,
      "--configLoader=runner",
      "--reporter=json",
    ],
  };
}

function validateExecutionReport(
  report: VitestJsonReport | null,
  declaration: ProductionReplacementDeclaration,
  artifact: ProductionReplacementArtifact,
  projectDir: string,
): string | null {
  if (
    report === null ||
    typeof report !== "object" ||
    report.success !== true ||
    !Array.isArray(report.testResults)
  ) return "Vitest did not produce a successful machine-readable report";

  const results = report.testResults.map((result) => ({
    ...result,
    repoPath: typeof result?.name === "string"
      ? vitestRepoPath(projectDir, result.name)
      : null,
  }));
  if (results.some((result) =>
    result.repoPath === null ||
    result.status !== "passed" ||
    !Array.isArray(result.assertionResults)
  )) return "Vitest report contains an unsafe, malformed, or non-passing test file result";
  const executedPaths = results.map((result) => result.repoPath!);
  if (!exactStringSet(executedPaths, declaration.productionTests)) {
    return "Vitest report does not contain exactly the declared production test files";
  }

  const bindings = [
    ...artifact.ingressObservations.map((observation) => ({
      label: `ingress ${JSON.stringify(observation.ingress)}`,
      binding: observation.test,
    })),
    ...artifact.retiredBoundary.tests.map((binding) => ({
      label: "retired boundary",
      binding,
    })),
  ];
  for (const { label, binding } of bindings) {
    const fileResult = results.find((result) => result.repoPath === binding.path);
    const matches = fileResult?.assertionResults.filter(
      (assertion) =>
        assertion !== null &&
        typeof assertion === "object" &&
        assertion.fullName === binding.name &&
        assertion.status === "passed",
    ) ?? [];
    if (matches.length !== 1) {
      return `${label} is not bound to one passing assertion named ${JSON.stringify(binding.name)} in ${binding.path}`;
    }
  }
  return null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateBindingProvenance(args: {
  report: VitestJsonReport;
  transformedPaths: Set<string>;
  projectDir: string;
  path: string;
  name: string;
  entrypoints: string[];
}): string | null {
  const results = args.report.testResults.map((result) => ({
    ...result,
    repoPath: typeof result?.name === "string"
      ? vitestRepoPath(args.projectDir, result.name)
      : null,
  }));
  if (
    args.report.success !== true ||
    !exactStringSet(
      results.map((result) => result.repoPath ?? ""),
      [args.path],
    )
  ) {
    return `isolated assertion ${JSON.stringify(args.name)} did not execute only ${args.path}`;
  }
  const matches = results[0]?.assertionResults.filter(
    (assertion) =>
      assertion !== null &&
      typeof assertion === "object" &&
      assertion.fullName === args.name &&
      assertion.status === "passed",
  ) ?? [];
  if (matches.length !== 1) {
    return `isolated production assertion ${JSON.stringify(args.name)} did not pass exactly once in ${args.path}`;
  }
  const missingEntrypoint = args.entrypoints.find(
    (entrypoint) => !args.transformedPaths.has(entrypoint),
  );
  return missingEntrypoint === undefined
    ? null
    : `assertion ${JSON.stringify(args.name)} in ${args.path} did not execute declared production entrypoint ${missingEntrypoint}; transformed: ${[...args.transformedPaths].join(", ")}`;
}

export function runProductionReplacementTests(args: {
  projectDir: string;
  declaration: ProductionReplacementDeclaration;
  artifact: ProductionReplacementArtifact;
}): string | null {
  const runtimeDir = join(args.projectDir, ".kota");
  mkdirSync(runtimeDir, { recursive: true });
  const executionDir = mkdtempSync(join(runtimeDir, "production-replacement-proof-"));
  try {
    const sandbox = resolveContainedWorkspaceSandbox(
      args.projectDir,
      30 * 60 * 1000,
    );
    if (sandbox.status === "unavailable") {
      return `declared production tests were not executed because the required OS sandbox is unavailable: ${sandbox.reason}`;
    }
    const fullExecution = executeVitest({
      projectDir: args.projectDir,
      testArgs: args.declaration.productionTests,
      runtimeHome: executionDir,
      sandbox,
    });
    if (!fullExecution.ok) return fullExecution.error;
    const reportError = validateExecutionReport(
      fullExecution.report,
      args.declaration,
      args.artifact,
      args.projectDir,
    );
    if (reportError !== null) return reportError;

    const boundAssertions = new Map<string, {
      path: string;
      name: string;
      entrypoints: Set<string>;
    }>();
    const bindings = [
      ...args.artifact.ingressObservations.map((observation) => observation.test),
      ...args.artifact.retiredBoundary.tests,
    ];
    for (const binding of bindings) {
      const key = `${binding.path}\0${binding.name}`;
      const existing = boundAssertions.get(key) ?? {
        path: binding.path,
        name: binding.name,
        entrypoints: new Set<string>(),
      };
      for (const entrypoint of binding.entrypoints) {
        existing.entrypoints.add(entrypoint);
      }
      boundAssertions.set(key, existing);
    }
    for (const binding of boundAssertions.values()) {
      const isolatedExecution = executeVitest({
        projectDir: args.projectDir,
        testArgs: [
          binding.path,
          "--testNamePattern",
          `^${escapeRegex(binding.name)}$`,
        ],
        runtimeHome: executionDir,
        sandbox,
      });
      if (!isolatedExecution.ok) return isolatedExecution.error;
      const provenanceError = validateBindingProvenance({
        report: isolatedExecution.report,
        transformedPaths: isolatedExecution.transformedPaths,
        projectDir: args.projectDir,
        path: binding.path,
        name: binding.name,
        entrypoints: [...binding.entrypoints],
      });
      if (provenanceError !== null) return provenanceError;
    }
    return null;
  } finally {
    rmSync(executionDir, { recursive: true, force: true, maxRetries: 3 });
  }
}
