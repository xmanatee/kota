import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initEventBus, resetEventBus } from "#core/events/event-bus.js";
import { buildAttentionCommand } from "./attention-cli.js";
import { NO_ATTENTION_ITEMS_TEXT, renderOnDemandAttention } from "./step.js";

async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((data: string | Uint8Array) => {
      chunks.push(typeof data === "string" ? data : Buffer.from(data).toString("utf-8"));
      return true;
    });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join("");
}

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.addCommand(buildAttentionCommand());
  return program;
}

function makeTaskDir(projectDir: string, state: string, count: number): void {
  const dir = join(projectDir, "data", "tasks", state);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, `task-test-${i}.md`), `# task ${i}\n`, "utf-8");
  }
}

describe("kota attention CLI", () => {
  let projectDir: string;
  let runsDir: string;
  let origCwd: string;
  const observed: Array<{ event: string; payload: unknown }> = [];
  let unsubscribe: () => void;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-attention-cli-"));
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
    origCwd = process.cwd();
    process.chdir(projectDir);

    observed.length = 0;
    const bus = initEventBus();
    const handler = (payload: unknown) => {
      observed.push({ event: "workflow.attention.digest", payload });
    };
    unsubscribe = bus.on("workflow.attention.digest", handler as never);
  });

  afterEach(() => {
    unsubscribe?.();
    resetEventBus();
    process.chdir(origCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("prints the same body renderOnDemandAttention produces when items exist", async () => {
    // Stalled work plus an empty backlog produce two attention items.
    makeTaskDir(projectDir, "doing", 2);
    makeTaskDir(projectDir, "ready", 1);

    const expected = renderOnDemandAttention({ projectDir, runsDir }).text;
    expect(expected).not.toBe(NO_ATTENTION_ITEMS_TEXT);

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "attention"]);
    });

    expect(out).toBe(`${expected}\n`);
  });

  it("prints the no-items reply when nothing warrants attention", async () => {
    makeTaskDir(projectDir, "ready", 1);
    makeTaskDir(projectDir, "backlog", 1);

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "attention"]);
    });

    expect(out).toBe(`${NO_ATTENTION_ITEMS_TEXT}\n`);
  });

  it("--json emits the structured AttentionItem[] payload and rendered text", async () => {
    makeTaskDir(projectDir, "doing", 2);
    makeTaskDir(projectDir, "ready", 1);

    const expected = renderOnDemandAttention({ projectDir, runsDir });

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "attention", "--json"]);
    });

    const parsed = JSON.parse(out.trim());
    expect(parsed).toEqual({ items: expected.items, text: expected.text });
  });

  it("does not write the cadence counter file or emit workflow.attention.digest", async () => {
    makeTaskDir(projectDir, "doing", 2);
    const counterFile = join(runsDir, "..", "attention-digest-counter.json");
    expect(existsSync(counterFile)).toBe(false);

    await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "attention"]);
      await makeProgram().parseAsync(["node", "kota", "attention", "--json"]);
    });

    expect(existsSync(counterFile)).toBe(false);
    expect(observed).toEqual([]);
  });
});
