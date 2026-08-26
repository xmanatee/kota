import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ProcessIdentity, ProcessSupervisor } from "./process-supervisor.js";

function waitForIdentity(supervisor: ProcessSupervisor): Promise<ProcessIdentity> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 2_000;
    const poll = () => {
      const identity = supervisor.identity;
      if (identity !== undefined) {
        resolve(identity);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("timed out waiting for process identity"));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

describe.skipIf(process.platform === "win32")("ProcessSupervisor", () => {
  it("returns durable process identity while streaming bounded output", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "kota-process-supervisor-"));
    const streamed = { stdout: "", stderr: "" };
    let spawnedIdentity: ProcessIdentity | undefined;
    try {
      const supervisor = new ProcessSupervisor({
        command: process.execPath,
        args: [
          "-e",
          'process.stdout.write(`${process.cwd()}|0123456789`); process.stderr.write("abcdefghij");',
        ],
        cwd,
        env: {},
        captureLimitBytesPerStream: 8,
        terminationGraceMs: 100,
        onSpawn: (identity) => {
          spawnedIdentity = ProcessSupervisor.identifySpawnedProcessGroup(identity.pid);
        },
        onOutput: ({ stream, data }) => {
          streamed[stream] += data;
        },
      });

      const outcome = await supervisor.run();

      expect(outcome.status).toBe("completed");
      if (outcome.status !== "completed") throw new Error("expected completed outcome");
      expect(spawnedIdentity).toEqual(outcome.identity);
      expect(outcome.identity).toEqual(supervisor.identity);
      expect(outcome.identity.pid).toBe(outcome.identity.processGroupId);
      expect(outcome.identity.observedCommandHash).toMatch(/^[a-f0-9]{64}$/);
      expect(outcome.identity.osStartToken).toMatch(/\d{2}:\d{2}:\d{2}/);
      expect(outcome.stdout).toEqual({
        text: "23456789",
        totalBytes: Buffer.byteLength(streamed.stdout),
        truncated: true,
      });
      expect(outcome.stderr).toEqual({ text: "cdefghij", totalBytes: 10, truncated: true });
      expect(streamed.stdout).toBe(`${realpathSync(cwd)}|0123456789`);
      expect(streamed.stderr).toBe("abcdefghij");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("gracefully terminates a persisted owned process with SIGTERM", async () => {
    let markReady: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const supervisor = new ProcessSupervisor({
      command: process.execPath,
      args: [
        "-e",
        'process.on("SIGTERM", () => process.exit(0)); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);',
      ],
      cwd: tmpdir(),
      env: {},
      captureLimitBytesPerStream: 1_024,
      terminationGraceMs: 200,
      onOutput: ({ stream, data }) => {
        if (stream === "stdout" && data.includes("ready")) markReady?.();
      },
    });
    const run = supervisor.run();
    const identity = await waitForIdentity(supervisor);

    expect(ProcessSupervisor.verifyOwnedProcess(identity).status).toBe("owned");
    await ready;
    const termination = await ProcessSupervisor.terminateOwnedProcess(identity, 200);
    const outcome = await run;

    expect(termination).toEqual({ status: "terminated", escalated: false });
    expect(outcome.status).toBe("completed");
    expect(ProcessSupervisor.verifyOwnedProcess(identity).status).toBe("not-running");
  });

  it("refuses to signal a persisted identity when the PID belongs to a different process", async () => {
    const supervisor = new ProcessSupervisor({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: tmpdir(),
      env: {},
      captureLimitBytesPerStream: 1_024,
      terminationGraceMs: 50,
    });
    const run = supervisor.run();
    const identity = await waitForIdentity(supervisor);
    const beforeExecIdentity = {
      ...identity,
      observedCommandHash: "0".repeat(64),
    };
    const staleIdentity = { ...identity, osStartToken: "stale-start-token" };

    const termination = await ProcessSupervisor.terminateOwnedProcess(staleIdentity, 20);

    expect(termination.status).toBe("identity-mismatch");
    expect(ProcessSupervisor.verifyOwnedProcess(beforeExecIdentity).status).toBe("owned");
    expect(ProcessSupervisor.verifyOwnedProcess(identity).status).toBe("owned");
    expect(() => process.kill(identity.pid, 0)).not.toThrow();
    await ProcessSupervisor.terminateOwnedProcess(identity, 20);
    await run;
  });

  it("aborts the entire process tree and escalates after the grace period", async () => {
    const controller = new AbortController();
    const grandchildScript =
      'process.on("SIGTERM", () => {}); process.stdout.write(`child:${process.pid}\\n`); setInterval(() => {}, 1000);';
    const parentScript =
      'const { spawn } = require("node:child_process");' +
      `spawn(process.execPath, ["-e", ${JSON.stringify(grandchildScript)}], { stdio: ["ignore", "inherit", "inherit"] });` +
      'process.on("SIGTERM", () => {}); process.stdout.write("parent-ready\\n"); setInterval(() => {}, 1000);';
    let output = "";
    let childPid: number | undefined;
    const supervisor = new ProcessSupervisor({
      command: process.execPath,
      args: ["-e", parentScript],
      cwd: tmpdir(),
      env: {},
      captureLimitBytesPerStream: 4_096,
      terminationGraceMs: 50,
      signal: controller.signal,
      onOutput: ({ stream, data }) => {
        if (stream !== "stdout") return;
        output += data;
        childPid = Number(/child:(\d+)/.exec(output)?.[1]) || childPid;
        if (childPid !== undefined && output.includes("parent-ready")) controller.abort();
      },
    });

    const outcome = await supervisor.run();

    expect(outcome.status).toBe("aborted");
    if (outcome.status !== "aborted") throw new Error("expected aborted outcome");
    expect(outcome.escalated).toBe(true);
    expect(childPid).toBeDefined();
    expect(() => process.kill(childPid!, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
  });

  it("cleans up descendants when the command leader exits", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "kota-process-supervisor-descendant-"));
    const marker = join(cwd, "escaped-marker");
    try {
      const childScript =
        `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "escaped"), 250)`;
      const parentScript =
        'const { spawn } = require("node:child_process");' +
        `spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], { stdio: "ignore" }).unref();`;
      const supervisor = new ProcessSupervisor({
        command: process.execPath,
        args: ["-e", parentScript],
        cwd,
        env: {},
        captureLimitBytesPerStream: 1_024,
        terminationGraceMs: 50,
      });

      const outcome = await supervisor.run();
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(outcome.status).toBe("completed");
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("returns a typed failure when the executable cannot be spawned", async () => {
    const supervisor = new ProcessSupervisor({
      command: join(tmpdir(), "missing-kota-process-supervisor"),
      args: [],
      cwd: tmpdir(),
      env: {},
      captureLimitBytesPerStream: 1_024,
      terminationGraceMs: 100,
    });

    const outcome = await supervisor.run();

    expect(outcome.status).toBe("spawn-failed");
    if (outcome.status !== "spawn-failed") throw new Error("expected spawn-failed outcome");
    expect(outcome.error.code).toBe("ENOENT");
    expect(outcome.commandHash).toMatch(/^[a-f0-9]{64}$/);
    expect(supervisor.identity).toBeUndefined();
  });
});
