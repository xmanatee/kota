import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ExecutableVerifierContext,
  executeIsolatedVerifier,
  resolveExecutableVerifierSandbox,
} from "./executable-verifier-sandbox.js";
import type { ExecutionProfilePreflightResult } from "./fixture-run.js";
import { OFFLINE_CONTAINER_NETWORK_POLICY } from "./provider-egress.js";
import {
  cleanupSubprocessTestDirs,
  createSubprocessTestDirs,
  type SubprocessTestDirs,
  writeFakeContainerBackend,
} from "./subprocess-executor-test-helpers.js";

const EXECUTION_PROFILE = {
  status: "verified",
  requestedProfile: {
    hostClass: "verifier-test",
    cpuAllocationCores: 1,
    cpuKillThresholdCores: 2,
    memoryAllocationMB: 256,
    memoryKillThresholdMB: 512,
  },
  observedOrEnforcedProfile: {
    hostClass: "verifier-test",
    cpuAllocationCores: 1,
    cpuKillThresholdCores: 2,
    memoryAllocationMB: 256,
    memoryKillThresholdMB: 512,
  },
  backendKind: "container",
  verification: "enforced",
  gateEligible: true,
  eligibilityReason: "verified-profile",
  networkPolicy: OFFLINE_CONTAINER_NETWORK_POLICY,
  diagnostics: [],
} as const satisfies ExecutionProfilePreflightResult;

type ContainerInvocationLog = {
  args: string[];
  command: string;
  commandArgs: string[];
  env: Record<string, string>;
  inheritedOpenAiApiKey?: string;
  mounts: string[];
};

function optionValues(args: readonly string[], option: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length - 1; index++) {
    if (args[index] === option) values.push(args[index + 1]!);
  }
  return values;
}

describe("executable verifier sandbox", () => {
  let dirs: SubprocessTestDirs;
  let fakeContainer: string;
  let invocationLog: string;
  let removalLog: string;
  let trustedRoot: string;
  let context: ExecutableVerifierContext;

  beforeEach(() => {
    dirs = createSubprocessTestDirs();
    fakeContainer = join(dirs.binariesDir, "fake-container.mjs");
    invocationLog = join(dirs.binariesDir, "container-log.jsonl");
    removalLog = join(dirs.binariesDir, "container-removals.txt");
    trustedRoot = join(dirs.binariesDir, "trusted-initial");
    mkdirSync(join(trustedRoot, "scripts"), { recursive: true });
    mkdirSync(join(dirs.workingDir, "scripts"), { recursive: true });
    writeFakeContainerBackend(fakeContainer);
    const scorer = "console.log('42');\n";
    writeFileSync(join(trustedRoot, "scripts", "score.mjs"), scorer);
    writeFileSync(join(dirs.workingDir, "scripts", "score.mjs"), scorer);
    context = {
      sandbox: resolveExecutableVerifierSandbox(
        {
          kind: "container",
          executable: fakeContainer,
          image: "kota-eval:test",
          kotaBinaryPath: "/opt/kota/bin/kota.mjs",
        },
        {
          PATH: process.env.PATH,
          KOTA_FAKE_CONTAINER_LOG: invocationLog,
          KOTA_FAKE_CONTAINER_REMOVE_LOG: removalLog,
        },
      ),
      executionProfile: EXECUTION_PROFILE,
      trustedVerifierRoot: trustedRoot,
    };
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    cleanupSubprocessTestDirs(dirs);
  });

  it("fails closed when no container isolation backend is configured", async () => {
    const execution = await executeIsolatedVerifier({
      context: {
        ...context,
        sandbox: resolveExecutableVerifierSandbox({ kind: "host-subprocess" }),
      },
      workingDir: dirs.workingDir,
      command: "true",
      timeoutMs: 1_000,
      maxBuffer: 1_024,
    });

    expect(execution).toMatchObject({
      started: false,
      issue: expect.stringContaining("verified isolated verifier"),
    });
    expect(existsSync(invocationLog)).toBe(false);
  });

  it("uses an offline bounded container, minimal env, immutable trusted scorers, and forced cleanup", async () => {
    process.env.OPENAI_API_KEY = "must-not-reach-verifier";
    const execution = await executeIsolatedVerifier({
      context,
      workingDir: dirs.workingDir,
      command: "node scripts/score.mjs",
      timeoutMs: 4_000,
      maxBuffer: 4_096,
    });

    expect(execution.started).toBe(true);
    if (!execution.started) throw new Error(execution.issue);
    expect(execution.result.status, execution.result.stderr).toBe(0);
    expect(execution.result.stdout.trim()).toBe("42");

    const log = JSON.parse(
      readFileSync(invocationLog, "utf8").trim(),
    ) as ContainerInvocationLog;
    expect(optionValues(log.args, "--network")).toEqual(["none"]);
    expect(optionValues(log.args, "--pull")).toEqual(["never"]);
    expect(optionValues(log.args, "--ipc")).toEqual(["none"]);
    expect(optionValues(log.args, "--cpus")).toEqual(["2"]);
    expect(optionValues(log.args, "--memory-reservation")).toEqual(["256m"]);
    expect(optionValues(log.args, "--memory")).toEqual(["512m"]);
    expect(optionValues(log.args, "--memory-swap")).toEqual(["512m"]);
    expect(optionValues(log.args, "--pids-limit")).toEqual(["64"]);
    expect(optionValues(log.args, "--ulimit")).toEqual([
      "cpu=4:4",
      "nofile=128:128",
    ]);
    expect(optionValues(log.args, "--tmpfs")).toEqual([
      "/tmp:rw,noexec,nosuid,nodev,size=64m",
    ]);
    expect(optionValues(log.args, "--cap-drop")).toEqual(["ALL"]);
    expect(optionValues(log.args, "--security-opt")).toEqual([
      "no-new-privileges",
    ]);
    expect(log.args).toContain("--read-only");
    expect(log.args).toContain("--init");
    expect(log.args).toContain("--name");
    expect(log.mounts).toEqual([
      `type=bind,source=${dirs.workingDir},target=${dirs.workingDir}`,
      `type=bind,source=${join(trustedRoot, "scripts", "score.mjs")},target=${join(dirs.workingDir, "scripts", "score.mjs")},readonly`,
    ]);
    expect(log.command).toBe("/bin/sh");
    expect(log.commandArgs).toEqual(["-c", "node scripts/score.mjs"]);
    expect(log.env).toEqual({
      CI: "1",
      HOME: "/tmp",
      LANG: "C",
      LC_ALL: "C",
      NO_COLOR: "1",
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      TMPDIR: "/tmp",
    });
    expect(log.inheritedOpenAiApiKey).toBeUndefined();
    expect(readFileSync(removalLog, "utf8").trim()).toMatch(
      /^kota-verifier-[a-f0-9-]{36}$/,
    );
  });

  it("rejects an agent-replaced trusted scorer before container launch", async () => {
    const scorerPath = join(dirs.workingDir, "scripts", "score.mjs");
    const target = join(dirs.binariesDir, "agent-scorer.mjs");
    writeFileSync(target, "process.exit(0);\n");
    writeFileSync(scorerPath, "replaced");
    // Replace the regular candidate entry after seeding it.
    unlinkSync(scorerPath);
    symlinkSync(target, scorerPath);

    const execution = await executeIsolatedVerifier({
      context,
      workingDir: dirs.workingDir,
      command: "node scripts/score.mjs",
      timeoutMs: 1_000,
      maxBuffer: 1_024,
    });

    expect(execution).toMatchObject({
      started: false,
      issue: expect.stringContaining("must remain a regular file"),
    });
    expect(existsSync(invocationLog)).toBe(false);
  });

  it("fails closed when full container cleanup cannot be confirmed", async () => {
    const sandbox = resolveExecutableVerifierSandbox(
      {
        kind: "container",
        executable: fakeContainer,
        image: "kota-eval:test",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      },
      {
        PATH: process.env.PATH,
        KOTA_FAKE_CONTAINER_LOG: invocationLog,
        KOTA_FAKE_CONTAINER_REMOVE_FAIL: "1",
        KOTA_FAKE_CONTAINER_REMOVE_LOG: removalLog,
      },
    );

    const execution = await executeIsolatedVerifier({
      context: { ...context, sandbox },
      workingDir: dirs.workingDir,
      command: "node scripts/score.mjs",
      timeoutMs: 1_000,
      maxBuffer: 1_024,
    });

    expect(execution).toMatchObject({
      started: false,
      issue: expect.stringContaining("cleanup could not be confirmed"),
    });
    expect(readFileSync(removalLog, "utf8").trim()).toMatch(
      /^kota-verifier-[a-f0-9-]{36}$/,
    );
  });
});
