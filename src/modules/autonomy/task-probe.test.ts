import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractTaskProbe, runTaskProbe } from "./task-probe.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-task-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
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
      "command: pnpm check:types",
      "timeoutMs: 60000",
      "",
      "## Done When",
      "",
    ].join("\n");
    const probe = extractTaskProbe(task);
    expect(probe).toEqual({ command: "pnpm check:types", timeoutMs: 60000 });
  });

  it("defaults timeoutMs when only command is specified", () => {
    const task = [
      "## Runtime Probe",
      "command: true",
    ].join("\n");
    const probe = extractTaskProbe(task);
    expect(probe).toEqual({ command: "true", timeoutMs: 120_000 });
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
    expect(probe).toEqual({ command: "pnpm run probe", timeoutMs: 5000 });
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
      "command: true",
      "retries: 3",
    ].join("\n");
    expect(() => extractTaskProbe(task)).toThrow(/unknown field "retries"/);
  });

  it("throws on a non-positive timeoutMs", () => {
    const task = [
      "## Runtime Probe",
      "command: true",
      "timeoutMs: 0",
    ].join("\n");
    expect(() => extractTaskProbe(task)).toThrow(/positive integer/);
  });

  it("throws when timeoutMs exceeds the cap", () => {
    const task = [
      "## Runtime Probe",
      "command: true",
      "timeoutMs: 99999999",
    ].join("\n");
    expect(() => extractTaskProbe(task)).toThrow(/exceeds the cap/);
  });

  it("throws when the same key is declared twice", () => {
    const task = [
      "## Runtime Probe",
      "command: one",
      "command: two",
    ].join("\n");
    expect(() => extractTaskProbe(task)).toThrow(/more than once/);
  });

  it("preserves colons inside the command value", () => {
    const task = [
      "## Runtime Probe",
      "command: pnpm run check:types && pnpm run test:unit",
    ].join("\n");
    const probe = extractTaskProbe(task);
    expect(probe?.command).toBe("pnpm run check:types && pnpm run test:unit");
  });
});

describe("runTaskProbe", () => {
  it("produces a pass verdict for exit code 0", () => {
    const dir = makeTmpDir();
    const result = runTaskProbe({ command: "exit 0", timeoutMs: 5000 }, dir);
    expect(result.verdict).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(typeof result.durationMs).toBe("number");
  });

  it("produces a fail verdict for a non-zero exit code and captures output", () => {
    const dir = makeTmpDir();
    const result = runTaskProbe(
      { command: "echo oops 1>&2; exit 3", timeoutMs: 5000 },
      dir,
    );
    expect(result.verdict).toBe("fail");
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain("oops");
  });

  it("captures stdout output on pass", () => {
    const dir = makeTmpDir();
    const result = runTaskProbe(
      { command: "echo hello-probe", timeoutMs: 5000 },
      dir,
    );
    expect(result.verdict).toBe("pass");
    expect(result.output).toContain("hello-probe");
  });
});
