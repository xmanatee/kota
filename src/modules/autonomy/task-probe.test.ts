import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractTaskProbe, runTaskProbe, type TaskProbe } from "./task-probe.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-task-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePackageJson(dir: string, scripts: Record<string, string>): void {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "probe-fixture", version: "0.0.0", scripts }, null, 2),
  );
}

function makeProbe(command: string): TaskProbe {
  const probe = extractTaskProbe([
    "## Runtime Probe",
    `command: ${command}`,
    "timeoutMs: 5000",
  ].join("\n"));
  if (!probe) throw new Error("expected probe");
  return probe;
}

describe("extractTaskProbe", () => {
  it("returns null when no Runtime Probe section is declared", () => {
    const task = [
      "---",
      "id: task-foo",
      "---",
      "## Problem",
      "Some body.",
    ].join("\n");
    expect(extractTaskProbe(task)).toBeNull();
  });

  it("parses a probe section with command and timeoutMs", () => {
    const task = [
      "## Problem",
      "",
      "## Runtime Probe",
      "command: pnpm run check:types",
      "timeoutMs: 60000",
      "",
      "## Done When",
      "",
    ].join("\n");
    const probe = extractTaskProbe(task);
    expect(probe).toEqual({
      command: "pnpm run check:types",
      executable: "pnpm",
      args: ["run", "check:types"],
      timeoutMs: 60000,
    });
  });

  it("defaults timeoutMs when only command is specified", () => {
    const task = [
      "## Runtime Probe",
      "command: pnpm test",
    ].join("\n");
    const probe = extractTaskProbe(task);
    expect(probe).toEqual({
      command: "pnpm test",
      executable: "pnpm",
      args: ["test"],
      timeoutMs: 120_000,
    });
  });

  it("accepts a fenced code block inside the section", () => {
    const task = [
      "## Runtime Probe",
      "",
      "```",
      "command: pnpm run probe",
      "timeoutMs: 5000",
      "```",
      "",
      "## Done When",
    ].join("\n");
    const probe = extractTaskProbe(task);
    expect(probe).toEqual({
      command: "pnpm run probe",
      executable: "pnpm",
      args: ["run", "probe"],
      timeoutMs: 5000,
    });
  });

  it("throws when command is missing", () => {
    const task = [
      "## Runtime Probe",
      "timeoutMs: 5000",
    ].join("\n");
    expect(() => extractTaskProbe(task)).toThrow(/missing required "command"/);
  });

  it("throws on a non-key-value line", () => {
    const task = [
      "## Runtime Probe",
      "this is not a key value pair",
    ].join("\n");
    expect(() => extractTaskProbe(task)).toThrow(/without "key: value"/);
  });

  it("throws on unknown fields", () => {
    const task = [
      "## Runtime Probe",
      "command: pnpm test",
      "retries: 3",
    ].join("\n");
    expect(() => extractTaskProbe(task)).toThrow(/unknown field "retries"/);
  });

  it("throws on a non-positive timeoutMs", () => {
    const task = [
      "## Runtime Probe",
      "command: pnpm test",
      "timeoutMs: 0",
    ].join("\n");
    expect(() => extractTaskProbe(task)).toThrow(/positive integer/);
  });

  it("rejects partially numeric and fractional timeoutMs values", () => {
    for (const timeoutMs of ["120000ms", "1.5"]) {
      const task = [
        "## Runtime Probe",
        "command: pnpm test",
        `timeoutMs: ${timeoutMs}`,
      ].join("\n");
      expect(() => extractTaskProbe(task)).toThrow(/positive integer/);
    }
  });

  it("throws when timeoutMs exceeds the cap", () => {
    const task = [
      "## Runtime Probe",
      "command: pnpm test",
      "timeoutMs: 99999999",
    ].join("\n");
    expect(() => extractTaskProbe(task)).toThrow(/exceeds the cap/);
  });

  it("throws when the same key is declared twice", () => {
    const task = [
      "## Runtime Probe",
      "command: pnpm test",
      "command: pnpm run other",
    ].join("\n");
    expect(() => extractTaskProbe(task)).toThrow(/more than once/);
  });

  it("preserves colons inside constrained command arguments", () => {
    const task = [
      "## Runtime Probe",
      "command: pnpm run check:types -- --filter=a:b",
    ].join("\n");
    const probe = extractTaskProbe(task);
    expect(probe?.args).toEqual(["run", "check:types", "--", "--filter=a:b"]);
  });

  it("accepts one provenance-pinned eval fixture run with a long timeout", () => {
    const task = [
      "## Runtime Probe",
      "command: pnpm kota eval run --fixture builder-scientific-claim-reproduction --repeats 1 --keep",
      `timeoutMs: ${4 * 60 * 60 * 1000}`,
    ].join("\n");
    const probe = extractTaskProbe(task);
    expect(probe).toEqual({
      command:
        "pnpm kota eval run --fixture builder-scientific-claim-reproduction --repeats 1 --keep",
      executable: "pnpm",
      args: [
        "kota",
        "eval",
        "run",
        "--fixture",
        "builder-scientific-claim-reproduction",
        "--repeats",
        "1",
        "--keep",
      ],
      timeoutMs: 4 * 60 * 60 * 1000,
    });
  });

  it("rejects broad or multi-fixture kota commands", () => {
    expect(() =>
      makeProbe("pnpm kota eval run --repeats 1 --keep"),
    ).toThrow(/exactly one eval fixture/);
    expect(() =>
      makeProbe(
        "pnpm kota eval run --fixture fixture-a --fixture fixture-b --repeats 1 --keep",
      ),
    ).toThrow(/must end with/);
  });

  it("keeps package-script probes capped at thirty minutes", () => {
    const task = [
      "## Runtime Probe",
      "command: pnpm test",
      `timeoutMs: ${30 * 60 * 1000 + 1}`,
    ].join("\n");
    expect(() => extractTaskProbe(task)).toThrow(/exceeds the cap/);
  });

  it("rejects shell control operators in command text", () => {
    const task = [
      "## Runtime Probe",
      "command: pnpm run check && pnpm run test",
    ].join("\n");
    expect(() => extractTaskProbe(task)).toThrow(/shell metacharacter "&"/);
  });

  it("rejects leading environment assignments", () => {
    const task = [
      "## Runtime Probe",
      "command: TOKEN=secret pnpm test",
    ].join("\n");
    expect(() => extractTaskProbe(task)).toThrow(/environment assignments/);
  });

  it("rejects unsupported executables", () => {
    const task = [
      "## Runtime Probe",
      "command: curl http://127.0.0.1:3000/health",
    ].join("\n");
    expect(() => extractTaskProbe(task)).toThrow(/must start with "pnpm"/);
  });

  it("rejects pnpm exec because the binary would come from task text", () => {
    const task = [
      "## Runtime Probe",
      "command: pnpm exec sh",
    ].join("\n");
    expect(() => extractTaskProbe(task)).toThrow(/subcommand "exec" is not allowed/);
  });
});

describe("runTaskProbe", () => {
  it("produces a pass verdict for exit code 0", () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      "probe:pass": "node -e \"process.exit(0)\"",
    });
    const result = runTaskProbe(makeProbe("pnpm run probe:pass"), dir);
    expect(result.verdict).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.execution).toBe("constrained-direct-command");
    expect(typeof result.durationMs).toBe("number");
  });

  it("produces a fail verdict for a non-zero exit code and captures output", () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      "probe:fail": "node -e \"console.error('oops'); process.exit(3)\"",
    });
    const result = runTaskProbe(makeProbe("pnpm run probe:fail"), dir);
    expect(result.verdict).toBe("fail");
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain("oops");
  });

  it("captures stdout output on pass", () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      "probe:stdout": "node -e \"console.log('hello-probe')\"",
    });
    const result = runTaskProbe(makeProbe("pnpm run probe:stdout"), dir);
    expect(result.verdict).toBe("pass");
    expect(result.output).toContain("hello-probe");
  });

  it("does not inherit arbitrary workflow environment values", () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      "probe:env": "node -e \"console.log(process.env.KOTA_PROBE_SECRET ?? 'missing')\"",
    });
    const previous = process.env.KOTA_PROBE_SECRET;
    process.env.KOTA_PROBE_SECRET = "probe-secret-value";
    try {
      const result = runTaskProbe(makeProbe("pnpm run probe:env"), dir);
      expect(result.verdict).toBe("pass");
      expect(result.output).toContain("missing");
      expect(result.output).not.toContain("probe-secret-value");
    } finally {
      if (previous === undefined) delete process.env.KOTA_PROBE_SECRET;
      else process.env.KOTA_PROBE_SECRET = previous;
    }
  });
});
