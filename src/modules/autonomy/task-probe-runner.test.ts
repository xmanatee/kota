import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskProbeSandbox } from "#core/agent-harness/task-probe-sandbox.js";
import { createWorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import {
  extractTaskProbe,
  runTaskProbe,
  type TaskProbe,
} from "./task-probe.js";

const resolveTaskProbeSandbox = vi.hoisted(() => vi.fn());

vi.mock("#core/agent-harness/task-probe-sandbox.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#core/agent-harness/task-probe-sandbox.js")>()),
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

function makeProbe(command: string, timeoutMs = 30_000): TaskProbe {
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

async function waitForDelayedProcess(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function runWithSandbox(
  probe: TaskProbe,
  projectDir: string,
  sandbox: TaskProbeSandbox,
): ReturnType<typeof runTaskProbe> {
  resolveTaskProbeSandbox.mockReturnValue(sandbox);
  return runTaskProbe(
    probe,
    projectDir,
    createWorkflowCommandRunner({ cwd: projectDir }),
  );
}

describe("runTaskProbe", () => {
  beforeEach(() => resolveTaskProbeSandbox.mockReturnValue(testSandbox));

  it("launches the sandbox-pinned executable instead of rediscovering pnpm", async () => {
    const dir = makeTmpDir();
    const pinnedPnpm = join(dir, "pinned-pnpm");
    writeFileSync(pinnedPnpm, '#!/bin/sh\necho "PINNED_PNPM_EXECUTED"\n');
    chmodSync(pinnedPnpm, 0o755);

    const result = await runWithSandbox(
      makeProbe("pnpm run probe:pass"),
      dir,
      { ...testSandbox, probeExecutable: pinnedPnpm },
    );

    expect(result.verdict).toBe("pass");
    expect(result.output).toContain("PINNED_PNPM_EXECUTED");
  });

  it("records an OS-contained pass", async () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { "probe:pass": "node -e \"process.exit(0)\"" });
    const result = await runWithSandbox(
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

  it("captures stdout and non-zero failures", async () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      "probe:fail": "node -e \"console.error('oops'); process.exit(3)\"",
    });
    const result = await runWithSandbox(
      makeProbe("pnpm run probe:fail"),
      dir,
      testSandbox,
    );

    expect(result.verdict).toBe("fail");
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain("oops");
  });

  it("kills the whole probe process group on timeout", async () => {
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

    const result = await runWithSandbox(
      makeProbe("pnpm run probe:timeout", 100),
      dir,
      { ...testSandbox, probeExecutable: pinnedPnpm },
    );
    await waitForDelayedProcess(500);

    expect(result.verdict).toBe("fail");
    expect(result.exitCode).toBe(124);
    expect(result.output).toContain("timed out after 100ms");
    expect(existsSync(marker)).toBe(false);
  });

  it("does not inherit arbitrary workflow environment values", async () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      "probe:env": "node -e \"console.log(process.env.KOTA_PROBE_SECRET ?? 'missing')\"",
    });
    const previous = process.env.KOTA_PROBE_SECRET;
    process.env.KOTA_PROBE_SECRET = "probe-secret-value";
    try {
      const result = await runWithSandbox(
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

  it("fails closed without starting pnpm when containment is unavailable", async () => {
    const dir = makeTmpDir();
    const marker = join(dir, "probe-ran.txt");
    writePackageJson(dir, {
      "probe:touch":
        `node -e "require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes')"`,
    });
    const result = await runWithSandbox(
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
