import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractTaskProbe,
  runTaskProbe,
  type TaskProbe,
} from "./task-probe.js";
import type { TaskProbeSandbox } from "./task-probe-sandbox.js";

const resolveTaskProbeSandbox = vi.hoisted(() => vi.fn());

vi.mock("./task-probe-sandbox.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./task-probe-sandbox.js")>()),
  resolveTaskProbeSandbox,
}));

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `kota-task-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePackageJson(dir: string, scripts: Record<string, string>): void {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "probe-fixture", version: "0.0.0", scripts }, null, 2),
  );
}

function makeProbe(command: string, timeoutMs = 5_000): TaskProbe {
  const probe = extractTaskProbe([
    "## Runtime Probe",
    `command: ${command}`,
    `timeoutMs: ${timeoutMs}`,
  ].join("\n"));
  if (!probe) throw new Error("expected probe");
  return probe;
}

const testSandbox: TaskProbeSandbox = {
  status: "available",
  kind: "linux-bubblewrap",
  processBoundary: "pid-namespace",
  command: "/usr/bin/env",
  prefixArgs: [],
  probeExecutable: "pnpm",
  evidence: "test process boundary",
};

function shellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function waitForDelayedProcess(delayMs: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function runWithSandbox(
  probe: TaskProbe,
  projectDir: string,
  sandbox: TaskProbeSandbox,
) {
  resolveTaskProbeSandbox.mockReturnValue(sandbox);
  return runTaskProbe(probe, projectDir);
}

describe("runTaskProbe", () => {
  beforeEach(() => resolveTaskProbeSandbox.mockReturnValue(testSandbox));

  it("launches the sandbox-pinned executable instead of rediscovering pnpm", () => {
    const dir = makeTmpDir();
    const pinnedPnpm = join(dir, "pinned-pnpm");
    writeFileSync(pinnedPnpm, '#!/bin/sh\necho "PINNED_PNPM_EXECUTED"\n');
    chmodSync(pinnedPnpm, 0o755);

    const result = runWithSandbox(
      makeProbe("pnpm run probe:pass"),
      dir,
      { ...testSandbox, probeExecutable: pinnedPnpm },
    );

    expect(result.verdict).toBe("pass");
    expect(result.output).toContain("PINNED_PNPM_EXECUTED");
  });

  it("records an OS-contained pass", () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { "probe:pass": "node -e \"process.exit(0)\"" });
    const result = runWithSandbox(
      makeProbe("pnpm run probe:pass"),
      dir,
      testSandbox,
    );

    expect(result).toMatchObject({
      verdict: "pass",
      exitCode: 0,
      execution: "os-contained-command",
      isolation: {
        status: "enforced",
        kind: "linux-bubblewrap",
        processBoundary: "pid-namespace",
        evidence: "test process boundary",
      },
    });
    expect(typeof result.durationMs).toBe("number");
  });

  it("captures stdout and non-zero failures", () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      "probe:fail": "node -e \"console.error('oops'); process.exit(3)\"",
    });
    const result = runWithSandbox(
      makeProbe("pnpm run probe:fail"),
      dir,
      testSandbox,
    );

    expect(result.verdict).toBe("fail");
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain("oops");
  });

  it("kills the whole probe process group on timeout", () => {
    const dir = makeTmpDir();
    const marker = join(dir, "late-timeout-marker");
    const worker = join(dir, "late-timeout-worker.cjs");
    const pinnedPnpm = join(dir, "pinned-pnpm");
    writeFileSync(
      worker,
      `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "escaped"), 300);\n`,
    );
    writeFileSync(
      pinnedPnpm,
      `#!/bin/sh\n${shellArg(process.execPath)} ${shellArg(worker)} &\nwait\n`,
    );
    chmodSync(pinnedPnpm, 0o755);

    const result = runWithSandbox(
      makeProbe("pnpm run probe:timeout", 100),
      dir,
      { ...testSandbox, probeExecutable: pinnedPnpm },
    );
    waitForDelayedProcess(500);

    expect(result.verdict).toBe("fail");
    expect(result.exitCode).toBe(124);
    expect(result.output).toContain("timed out after 100 ms");
    expect(existsSync(marker)).toBe(false);
  });

  it("kills background probe descendants after the launcher exits", () => {
    const dir = makeTmpDir();
    const marker = join(dir, "late-background-marker");
    const worker = join(dir, "late-background-worker.cjs");
    const pinnedPnpm = join(dir, "pinned-pnpm");
    writeFileSync(
      worker,
      `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "escaped"), 300);\n`,
    );
    writeFileSync(
      pinnedPnpm,
      `#!/bin/sh\n${shellArg(process.execPath)} ${shellArg(worker)} >/dev/null 2>&1 &\nexit 0\n`,
    );
    chmodSync(pinnedPnpm, 0o755);

    const result = runWithSandbox(
      makeProbe("pnpm run probe:background"),
      dir,
      { ...testSandbox, probeExecutable: pinnedPnpm },
    );
    waitForDelayedProcess(500);

    expect(result.verdict).toBe("pass");
    expect(existsSync(marker)).toBe(false);
  });

  it("does not inherit arbitrary workflow environment values", () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      "probe:env": "node -e \"console.log(process.env.KOTA_PROBE_SECRET ?? 'missing')\"",
    });
    const previous = process.env.KOTA_PROBE_SECRET;
    process.env.KOTA_PROBE_SECRET = "probe-secret-value";
    try {
      const result = runWithSandbox(
        makeProbe("pnpm run probe:env"),
        dir,
        testSandbox,
      );
      expect(result.output).toContain("missing");
      expect(result.output).not.toContain("probe-secret-value");
    } finally {
      if (previous === undefined) delete process.env.KOTA_PROBE_SECRET;
      else process.env.KOTA_PROBE_SECRET = previous;
    }
  });

  it("fails closed without starting pnpm when containment is unavailable", () => {
    const dir = makeTmpDir();
    const marker = join(dir, "probe-ran.txt");
    writePackageJson(dir, {
      "probe:touch":
        `node -e "require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes')"`,
    });
    const result = runWithSandbox(
      makeProbe("pnpm run probe:touch"),
      dir,
      { status: "unavailable", reason: "test sandbox unavailable" },
    );

    expect(result).toMatchObject({
      verdict: "fail",
      exitCode: -1,
      execution: "not-executed",
      isolation: {
        status: "unavailable",
        reason: "test sandbox unavailable",
      },
    });
    expect(existsSync(marker)).toBe(false);
  });
});
