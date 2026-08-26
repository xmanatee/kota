import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkflowCommandRunner,
  WorkflowCommandError,
} from "./workflow-command.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kota-workflow-command-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform === "win32")("workflow command execution", () => {
  it("runs an argv command with the requested cwd and environment", async () => {
    const cwd = tempDir();
    const runCommand = createWorkflowCommandRunner({
      cwd: tmpdir(),
      env: { BASE_VALUE: "base" },
    });

    const result = await runCommand({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write(`${process.cwd()}|${process.env.BASE_VALUE}|${process.env.OVERRIDE_VALUE}`)",
      ],
      cwd,
      env: { OVERRIDE_VALUE: "override" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.text).toBe(`${realpathSync(cwd)}|base|override`);
    expect(result.stderr.text).toBe("");
    expect(result.stdout.truncated).toBe(false);
  });

  it("can replace inherited runtime environment for untrusted commands", async () => {
    const inheritedKey = "KOTA_WORKFLOW_COMMAND_INHERITED_TEST";
    const previous = process.env[inheritedKey];
    process.env[inheritedKey] = "host-secret";
    try {
      const runCommand = createWorkflowCommandRunner({
        cwd: tempDir(),
        env: { BASE_VALUE: "base-secret" },
      });

      const result = await runCommand({
        command: process.execPath,
        args: [
          "-e",
          `process.stdout.write(JSON.stringify({
            inherited: process.env.${inheritedKey} ?? null,
            base: process.env.BASE_VALUE ?? null,
            explicit: process.env.EXPLICIT_VALUE ?? null,
            path: typeof process.env.PATH,
          }))`,
        ],
        env: { EXPLICIT_VALUE: "allowed" },
        envMode: "replace",
      });

      expect(JSON.parse(result.stdout.text)).toEqual({
        inherited: null,
        base: null,
        explicit: "allowed",
        path: "string",
      });
    } finally {
      if (previous === undefined) delete process.env[inheritedKey];
      else process.env[inheritedKey] = previous;
    }
  });

  it("provides explicit stdin to a supervised command", async () => {
    const runCommand = createWorkflowCommandRunner({ cwd: tempDir() });

    const result = await runCommand({
      command: process.execPath,
      args: [
        "-e",
        "process.stdin.setEncoding('utf8'); let value = ''; process.stdin.on('data', chunk => value += chunk); process.stdin.on('end', () => process.stdout.write(value.toUpperCase()));",
      ],
      stdin: "runtime-owned input",
    });

    expect(result.stdout.text).toBe("RUNTIME-OWNED INPUT");
  });

  it("reports a nonzero exit with captured diagnostic output", async () => {
    const runCommand = createWorkflowCommandRunner({ cwd: tempDir() });

    const failure = runCommand({
      command: process.execPath,
      args: ["-e", "process.stderr.write('broken check'); process.exit(7)"],
    });

    await expect(failure).rejects.toMatchObject({
      kind: "failed",
      exitCode: 7,
      stderr: { text: "broken check", truncated: false },
    });
    await expect(failure).rejects.toThrow(/broken check/);
  });

  it("terminates a command when its timeout expires", async () => {
    const runCommand = createWorkflowCommandRunner({ cwd: tempDir() });

    const failure = runCommand({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeoutMs: 50,
      terminationGraceMs: 20,
    });

    await expect(failure).rejects.toMatchObject({ kind: "timed-out" });
    await expect(failure).rejects.toThrow(/timed out after 50ms/);
  });

  it("terminates a command and preserves the cancellation reason", async () => {
    const controller = new AbortController();
    const runCommand = createWorkflowCommandRunner({
      cwd: tempDir(),
      signal: controller.signal,
    });
    const failure = runCommand({
      command: process.execPath,
      args: ["-e", "process.stdout.write('ready'); setInterval(() => {}, 1000)"],
      terminationGraceMs: 20,
    });
    const reason = new Error("workflow cancelled");

    setTimeout(() => controller.abort(reason), 25);

    await expect(failure).rejects.toBe(reason);
  });

  it("terminates output floods while retaining only the configured tail", async () => {
    const runCommand = createWorkflowCommandRunner({ cwd: tempDir() });

    try {
      await runCommand({
        command: process.execPath,
        args: [
          "-e",
          "process.stdout.write('x'.repeat(100_000)); setInterval(() => {}, 1000)",
        ],
        outputLimitBytes: 1_024,
        captureLimitBytesPerStream: 128,
        terminationGraceMs: 20,
      });
      throw new Error("expected command to exceed its output limit");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowCommandError);
      if (!(error instanceof WorkflowCommandError)) throw error;
      expect(error.kind).toBe("output-limit");
      expect(error.stdout.totalBytes).toBeGreaterThan(1_024);
      expect(Buffer.byteLength(error.stdout.text)).toBeLessThanOrEqual(128);
      expect(error.stdout.truncated).toBe(true);
      expect(error.message).toMatch(/output exceeded 1024 bytes/);
    }
  });
});
