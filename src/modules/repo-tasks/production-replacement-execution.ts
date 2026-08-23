import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AvailableContainedWorkspaceSandbox,
  resolveContainedWorkspaceSandbox,
} from "#core/agent-harness/task-probe-sandbox.js";
import { buildRequiredInheritedSubprocessEnv } from "#core/modules/subprocess-env.js";
import {
  type AssertionCoverageHarness,
  readAssertionCoveragePaths,
  writeAssertionCoverageHarness,
} from "./production-replacement-assertion-coverage.js";
import type { ProductionReplacementArtifact } from "./production-replacement-evidence.js";
import type { ProductionReplacementDeclaration } from "./production-replacement-proof.js";
import { vitestRepoPath } from "./production-replacement-vitest-paths.js";

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
    assertionCoveragePaths: Set<string> | null;
  }
  | { ok: false; error: string };

type SandboxedVitestEnvelope = {
  schemaVersion?: number;
  report?: string;
  assertionCoverage?: string | null;
};

function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((value) => expected.includes(value));
}

function writeSandboxedVitestRunner(args: {
  projectDir: string;
  testArgs: readonly string[];
  outputFile: string;
  runnerFile: string;
  sandbox: AvailableContainedWorkspaceSandbox;
  coverageHarness?: AssertionCoverageHarness;
}): void {
  const vitestArgs = [
    "exec",
    "vitest",
    "run",
    ...args.testArgs,
    ...(args.coverageHarness === undefined
      ? []
      : [`--config=${args.coverageHarness.configFile}`]),
    "--configLoader=runner",
    "--reporter=json",
    `--outputFile=${args.outputFile}`,
  ];
  const assertionCoverageFile = args.coverageHarness?.observationFile ?? null;
  writeFileSync(
    args.runnerFile,
    `import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const execution = spawnSync(
  ${JSON.stringify(args.sandbox.probeExecutable)},
  ${JSON.stringify(vitestArgs)},
  {
    cwd: ${JSON.stringify(args.projectDir)},
    encoding: "utf-8",
    env: process.env,
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
  ].filter((value) => value.length > 0).join("\\n").trim();
  process.stderr.write(detail);
  process.exit(execution.status ?? 1);
}
try {
  process.stdout.write(JSON.stringify({
    schemaVersion: 1,
    report: readFileSync(${JSON.stringify(args.outputFile)}, "utf-8"),
    assertionCoverage: ${assertionCoverageFile === null
      ? "null"
      : `readFileSync(${JSON.stringify(assertionCoverageFile)}, "utf-8")`},
  }));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`,
    { mode: 0o600 },
  );
}

function executeVitest(args: {
  projectDir: string;
  testArgs: string[];
  runtimeHome: string;
  sandbox: AvailableContainedWorkspaceSandbox;
  outputFile: string;
  coverageHarness?: AssertionCoverageHarness;
}): VitestExecution {
  const runnerFile = `${args.outputFile}.runner.mjs`;
  writeSandboxedVitestRunner({
    projectDir: args.projectDir,
    testArgs: args.testArgs,
    outputFile: args.outputFile,
    runnerFile,
    sandbox: args.sandbox,
    coverageHarness: args.coverageHarness,
  });
  const launch = buildProductionReplacementVitestLaunch(
    args.sandbox,
    args.testArgs,
    runnerFile,
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
    const envelope = JSON.parse(execution.stdout) as SandboxedVitestEnvelope;
    if (envelope.schemaVersion !== 1 || typeof envelope.report !== "string") {
      throw new Error("sandbox did not return a valid Vitest result envelope");
    }
    const report = JSON.parse(envelope.report) as VitestJsonReport;
    if (args.coverageHarness === undefined) {
      return { ok: true, report, assertionCoveragePaths: null };
    }
    if (typeof envelope.assertionCoverage !== "string") {
      return {
        ok: false,
        error: "assertion-scoped runtime coverage is unreadable: sandbox did not return an observation",
      };
    }
    writeFileSync(
      args.coverageHarness.observationFile,
      envelope.assertionCoverage,
      { encoding: "utf-8", mode: 0o600 },
    );
    const coverage = readAssertionCoveragePaths({
      projectDir: args.projectDir,
      observationFile: args.coverageHarness.observationFile,
    });
    return coverage.ok
      ? { ok: true, report, assertionCoveragePaths: coverage.paths }
      : coverage;
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
  sandboxRunnerFile?: string,
): { command: string; args: string[] } {
  return {
    command: sandbox.command,
    args: [
      ...sandbox.prefixArgs,
      sandbox.probeExecutable,
      "exec",
      ...(sandboxRunnerFile === undefined
        ? [
            "vitest",
            "run",
            ...testArgs,
            "--configLoader=runner",
            "--reporter=json",
          ]
        : ["node", sandboxRunnerFile]),
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
  assertionCoveragePaths: Set<string>;
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
    (entrypoint) => !args.assertionCoveragePaths.has(entrypoint),
  );
  return missingEntrypoint === undefined
    ? null
    : `assertion ${JSON.stringify(args.name)} in ${args.path} did not exercise declared production entrypoint ${missingEntrypoint} during assertion-scoped runtime coverage; observed: ${[...args.assertionCoveragePaths].join(", ")}`;
}

export function runProductionReplacementTests(args: {
  projectDir: string;
  declaration: ProductionReplacementDeclaration;
  artifact: ProductionReplacementArtifact;
}): string | null {
  const runtimeDir = join(args.projectDir, ".kota");
  mkdirSync(runtimeDir, { recursive: true });
  const executionDir = mkdtempSync(join(runtimeDir, "production-replacement-proof-"));
  const outputFile = join(executionDir, "vitest-report.json");
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
      outputFile,
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
    let index = 0;
    for (const binding of boundAssertions.values()) {
      const coverageHarness = writeAssertionCoverageHarness({
        projectDir: args.projectDir,
        executionDir,
        index,
      });
      const isolatedExecution = executeVitest({
        projectDir: args.projectDir,
        testArgs: [
          binding.path,
          "--testNamePattern",
          `^${escapeRegex(binding.name)}$`,
        ],
        runtimeHome: executionDir,
        sandbox,
        outputFile: join(executionDir, `binding-${index}.json`),
        coverageHarness,
      });
      index += 1;
      if (!isolatedExecution.ok) return isolatedExecution.error;
      if (isolatedExecution.assertionCoveragePaths === null) {
        return "isolated production assertion did not produce assertion-scoped runtime coverage";
      }
      const provenanceError = validateBindingProvenance({
        report: isolatedExecution.report,
        assertionCoveragePaths: isolatedExecution.assertionCoveragePaths,
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
