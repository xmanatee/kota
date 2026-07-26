import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveScientificClaimAnalyzerSandbox,
  type ScientificClaimAnalyzerSandbox,
  spawnScientificClaimAnalyzer,
} from "./scientific-claim-analyzer-sandbox.js";
import {
  cleanupSubprocessTestDirs,
  createSubprocessTestDirs,
  type SubprocessTestDirs,
  writeFakeContainerBackend,
} from "./subprocess-executor-test-helpers.js";

type ContainerInvocationLog = {
  args: string[];
  command: string;
  commandArgs: string[];
  env: Record<string, string>;
  image: string;
  mounts: string[];
  workdir: string;
};

function optionValues(args: readonly string[], option: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length - 1; index++) {
    if (args[index] === option) values.push(args[index + 1]!);
  }
  return values;
}

describe("scientific claim analyzer process sandbox", () => {
  let dirs: SubprocessTestDirs;
  let fakeContainer: string;
  let invocationLog: string;
  let isolation: ScientificClaimAnalyzerSandbox;

  beforeEach(() => {
    dirs = createSubprocessTestDirs();
    fakeContainer = join(dirs.binariesDir, "fake-container.mjs");
    invocationLog = join(dirs.binariesDir, "container-log.jsonl");
    writeFakeContainerBackend(fakeContainer);
    process.env.KOTA_FAKE_CONTAINER_LOG = invocationLog;
    isolation = resolveScientificClaimAnalyzerSandbox({
      kind: "container",
      executable: fakeContainer,
      image: "kota-eval:test",
      kotaBinaryPath: "/opt/kota/bin/kota.mjs",
    });
  });

  afterEach(() => {
    delete process.env.KOTA_FAKE_CONTAINER_LOG;
    delete process.env.KOTA_FAKE_CONTAINER_NODE_MAX_OLD_SPACE_MB;
    cleanupSubprocessTestDirs(dirs);
  });

  function seedAnalyzer(source: string): {
    analyzer: string;
    input: string;
    output: string;
  } {
    const analyzer = join(dirs.workingDir, "scripts", "analyzer.mjs");
    const input = join(dirs.workingDir, "data", "input.csv");
    const output = join(dirs.workingDir, "result.json");
    mkdirSync(join(dirs.workingDir, "scripts"), { recursive: true });
    mkdirSync(join(dirs.workingDir, "data"), { recursive: true });
    writeFileSync(analyzer, source, { encoding: "utf8", mode: 0o400 });
    writeFileSync(input, "value\n1\n", { encoding: "utf8", mode: 0o400 });
    return { analyzer, input, output };
  }

  function executeAnalyzer(paths: {
    analyzer: string;
    input: string;
    output: string;
  }) {
    return spawnScientificClaimAnalyzer(
      isolation,
      {
        nodeOptions: [],
        scriptPath: "scripts/analyzer.mjs",
        scriptArgs: ["result.json"],
      },
      {
        cwd: dirs.workingDir,
        env: { LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
        maxBuffer: 512 * 1024,
        readOnlyPaths: [paths.analyzer, paths.input],
        timeout: 5_000,
        writablePaths: [paths.output],
      },
    );
  }

  it("fails closed when the eval run has no configured container backend", () => {
    expect(
      resolveScientificClaimAnalyzerSandbox({ kind: "host-subprocess" }),
    ).toMatchObject({
      kind: "unavailable",
      issue: expect.stringContaining("requires --isolation container"),
    });
  });

  it("runs with hard memory, CPU, PID, descriptor, filesystem, and network limits", async () => {
    const paths = seedAnalyzer(`
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], JSON.stringify({ ok: true }));
`);
    const execution = await executeAnalyzer(paths);

    expect(execution.started).toBe(true);
    if (!execution.started) throw new Error(execution.issue);
    expect(execution.result.status, execution.result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(paths.output, "utf8"))).toEqual({ ok: true });

    const log = JSON.parse(readFileSync(invocationLog, "utf8")) as ContainerInvocationLog;
    expect(optionValues(log.args, "--network")).toEqual(["none"]);
    expect(optionValues(log.args, "--cpus")).toEqual(["0.5"]);
    expect(optionValues(log.args, "--memory")).toEqual(["256m"]);
    expect(optionValues(log.args, "--memory-swap")).toEqual(["256m"]);
    expect(optionValues(log.args, "--pids-limit")).toEqual(["32"]);
    expect(optionValues(log.args, "--ulimit")).toEqual([
      "cpu=10:10",
      "nofile=64:64",
    ]);
    expect(optionValues(log.args, "--cap-drop")).toEqual(["ALL"]);
    expect(optionValues(log.args, "--security-opt")).toEqual([
      "no-new-privileges",
    ]);
    expect(log.args).toContain("--read-only");
    expect(log.args).toContain("--rm");
    expect(log.args).toContain("--init");
    expect(optionValues(log.args, "--tmpfs")).toEqual([
      "/tmp:rw,noexec,nosuid,nodev,size=16m",
    ]);
    expect(log.mounts).toEqual([
      `type=bind,source=${dirs.workingDir},target=${dirs.workingDir},readonly`,
      `type=bind,source=${paths.output},target=${paths.output}`,
    ]);
    expect(log.workdir).toBe(dirs.workingDir);
    expect(log.image).toBe("kota-eval:test");
    expect(log.command).toBe("node");
    expect(log.commandArgs).toEqual(["scripts/analyzer.mjs", "result.json"]);
    expect(log.env).toEqual({ LANG: "C", LC_ALL: "C", NO_COLOR: "1" });
  });

  it("refuses to expose undeclared fixture files to the analyzer container", async () => {
    const paths = seedAnalyzer("process.exit(0);\n");
    writeFileSync(join(dirs.workingDir, "undeclared.txt"), "secret");

    const execution = await executeAnalyzer(paths);

    expect(execution).toMatchObject({
      started: false,
      issue: expect.stringContaining("undeclared file"),
    });
    expect(existsSync(invocationLog)).toBe(false);
  });

  it("terminates an allocation-heavy analyzer while the evaluator remains responsive", async () => {
    const paths = seedAnalyzer(`
await new Promise((resolve) => setTimeout(resolve, 100));
const retained = [];
while (true) retained.push(new Array(250_000).fill("allocation-pressure"));
`);
    process.env.KOTA_FAKE_CONTAINER_NODE_MAX_OLD_SPACE_MB = "16";
    const startedAt = Date.now();
    let analyzerSettled = false;

    const executionPromise = executeAnalyzer(paths).then((execution) => {
      analyzerSettled = true;
      return execution;
    });
    const firstCompletion = await Promise.race([
      executionPromise.then(() => "analyzer" as const),
      new Promise<"heartbeat">((resolve) =>
        setTimeout(() => resolve("heartbeat"), 25),
      ),
    ]);

    expect(firstCompletion).toBe("heartbeat");
    expect(analyzerSettled).toBe(false);
    const execution = await executionPromise;

    expect(execution.started).toBe(true);
    if (!execution.started) throw new Error(execution.issue);
    expect(execution.result.status).not.toBe(0);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});
