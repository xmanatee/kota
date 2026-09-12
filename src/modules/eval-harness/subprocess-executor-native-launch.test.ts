import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ProcessOutcome, ProcessSupervisorOptions } from "#core/execution/process-supervisor.js";
import { createSubprocessExecutor } from "./subprocess-executor.js";
import { cleanupSubprocessTestDirs, createSubprocessTestDirs, writeFakeContainerBackend } from "./subprocess-executor-test-helpers.js";

const launch = vi.hoisted(() => vi.fn<(options: ProcessSupervisorOptions) => Promise<ProcessOutcome>>());
// The external launch port is controlled; candidate argument construction,
// resource policy, auth snapshots and cleanup remain production-owned.
vi.mock("#core/execution/process-supervisor.js", () => ({
  ProcessSupervisor: class {
    constructor(private readonly options: ProcessSupervisorOptions) {}
    run() { return launch(this.options); }
  },
}));
afterEach(() => launch.mockReset());

it("gives the native candidate namespace support without outer capabilities or writable image access", async () => {
  const dirs = createSubprocessTestDirs();
  try {
    const docker = join(dirs.binariesDir, "docker.mjs");
    writeFakeContainerBackend(docker);
    const login = join(dirs.binariesDir, "login.json");
    writeFileSync(login, "synthetic-login", { mode: 0o600 });
    const executor = createSubprocessExecutor({
      kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      isolationBackend: { kind: "container", executable: docker, image: "test:image", kotaBinaryPath: "/opt/kota/bin/kota.mjs" },
      providerEgressTaskBoundary: { agentHarness: "codex", toolControl: "native" },
      containerAuth: { sourceFile: login, containerDirectory: "/run/login", fileName: "auth.json", locatorEnvKey: "CODEX_HOME" },
    });
    launch.mockImplementation(async (request) => {
      const value = (key: string) => request.args[request.args.indexOf(key) + 1];
      const owner = statSync(dirs.workingDir);
      expect(value("--user")).toBe(`${owner.uid}:${owner.gid}`);
      expect(value("--cap-drop")).toBe("ALL");
      expect(request.args).toEqual(expect.arrayContaining(["seccomp=unconfined", "no-new-privileges", "--read-only"]));
      expect(request.args).not.toContain("--cap-add");
      expect(request.args).not.toContain("--privileged");
      expect(value("--network")).toBe("none");
      expect(request.args).toContain(`type=bind,source=${dirs.workingDir},target=${dirs.workingDir}`);
      expect(readFileSync(value("--env-file")!, "utf8")).toContain("CODEX_HOME=/run/login");
      const authMount = request.args.find((arg) => arg.endsWith("target=/run/login,readonly"))!;
      const snapshot = authMount.split("source=")[1]!.split(",target=")[0]!;
      expect(statSync(join(snapshot, "auth.json")).uid).toBe(owner.uid);
      expect(request.args).toEqual(expect.arrayContaining(["--agent-harness", "codex", "--agent-model", "gpt-5.5"]));
      return { status: "completed", identity: { pid: 123, processGroupId: 123, observedCommandHash: "native-launch", osStartToken: "fixture" }, exitCode: 1, signal: null,
        stdout: { text: "", totalBytes: 0, truncated: false }, stderr: { text: "synthetic exit", totalBytes: 14, truncated: false } };
    });
    const profile = executor.preflight({ hostClass: "native-launch", cpuAllocationCores: 1, cpuKillThresholdCores: 1, memoryAllocationMB: 512, memoryKillThresholdMB: 512 });
    const result = await executor.execute({ workflowName: "builder", workingDir: dirs.workingDir, budgetMs: 5000, executionProfile: profile,
      agentExecutionOverride: { harness: "codex", model: "gpt-5.5" } });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("error");
  } finally {
    cleanupSubprocessTestDirs(dirs);
  }
});
