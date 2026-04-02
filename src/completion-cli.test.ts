import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { registerCompletionCommands } from "./completion-cli.js";

function makeProgram(): Command {
  const program = new Command("kota");
  program.exitOverride();

  // Add a subcommand with options to exercise completions
  const workflow = program.command("workflow").description("Manage workflows");
  workflow.command("list").description("List workflows").option("--status <s>", "filter by status");
  workflow.command("run").description("Run a workflow").option("--workflow <name>", "workflow name");

  program.command("task").description("Manage tasks");
  registerCompletionCommands(program);
  return program;
}

function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
    chunks.push(String(data));
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join("");
}

describe("kota completion", () => {
  it("generates zsh completion script with top-level commands", () => {
    const program = makeProgram();
    const out = captureStdout(() => program.parse(["node", "kota", "completion", "zsh"]));
    expect(out).toContain("#compdef kota");
    expect(out).toContain("workflow");
    expect(out).toContain("task");
    expect(out).toContain("completion");
    expect(out).toContain("_kota");
  });

  it("generates bash completion script with top-level commands", () => {
    const program = makeProgram();
    const out = captureStdout(() => program.parse(["node", "kota", "completion", "bash"]));
    expect(out).toContain("# kota bash completion");
    expect(out).toContain("_kota_completion");
    expect(out).toContain("complete -F _kota_completion kota");
    expect(out).toContain("workflow");
    expect(out).toContain("task");
  });

  it("zsh completion includes subcommands of workflow", () => {
    const program = makeProgram();
    const out = captureStdout(() => program.parse(["node", "kota", "completion", "zsh"]));
    expect(out).toContain("list");
    expect(out).toContain("run");
  });

  it("bash completion includes flags for subcommands", () => {
    const program = makeProgram();
    const out = captureStdout(() => program.parse(["node", "kota", "completion", "bash"]));
    expect(out).toContain("--status");
    expect(out).toContain("--workflow");
  });

  it("auto-detects zsh from SHELL env", () => {
    const original = process.env.SHELL;
    process.env.SHELL = "/usr/local/bin/zsh";
    const program = makeProgram();
    const out = captureStdout(() => program.parse(["node", "kota", "completion"]));
    expect(out).toContain("#compdef kota");
    process.env.SHELL = original;
  });

  it("auto-detects bash from SHELL env", () => {
    const original = process.env.SHELL;
    process.env.SHELL = "/bin/bash";
    const program = makeProgram();
    const out = captureStdout(() => program.parse(["node", "kota", "completion"]));
    expect(out).toContain("_kota_completion");
    process.env.SHELL = original;
  });

  it("exits with error for unknown shell", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const program = makeProgram();
    expect(() => program.parse(["node", "kota", "completion", "fish"])).toThrow();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown shell"));
    errSpy.mockRestore();
  });
});
