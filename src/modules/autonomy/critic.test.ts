import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CriticVerdict } from "./critic.js";
import { createCriticCheck } from "./critic.js";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  // Must be a constructor (callable with `new`)
  const MockAnthropic = vi.fn(function (this: { messages: { create: typeof mockCreate } }) {
    this.messages = { create: mockCreate };
  });
  return { default: MockAnthropic };
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual("node:child_process");
  return {
    ...actual,
    execFileSync: vi.fn(() => ""),
  };
});

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-critic-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeContext(projectDir: string, runDirPath?: string) {
  return {
    projectDir,
    workflow: {
      name: "builder",
      runId: "test-run",
      runDirPath: runDirPath ?? join(projectDir, ".kota/runs/test-run"),
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    },
    trigger: { event: "autonomy.queue.available", payload: {} },
    stepOutputs: {},
    stepResults: {},
    runTool: vi.fn(),
    emit: vi.fn(),
    requestRestart: vi.fn(),
    readPrompt: vi.fn(),
    triggerWorkflow: vi.fn(),
    readRuntimeState: vi.fn(),
  } as never;
}

function setApiResponse(verdict: CriticVerdict) {
  mockCreate.mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify(verdict) }],
  });
}

type CodeCheck = { run: (ctx: never) => Promise<unknown> };

describe("createCriticCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips when no task in doing/", async () => {
    const dir = makeTmpDir();
    const check = createCriticCheck();
    const result = await (check as CodeCheck).run(makeContext(dir));
    expect(result).toMatch(/skipping critic review/);
  });

  it("calls Anthropic API and passes on pass verdict", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-foo.md"), "---\ntitle: Do foo\n---\nDo foo.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Work looks complete.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir));

    expect(result).toMatch(/pass/);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("throws on fail verdict with critical issues", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-bar.md"), "---\ntitle: Do bar\n---\nDo bar.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    setApiResponse({
      verdict: "fail",
      critical_issues: ["Missing unit tests", "Docs not updated"],
      warnings: [],
      summary: "Work is incomplete.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await expect(
      (check as CodeCheck).run(makeContext(dir, runDir)),
    ).rejects.toThrow(/2 critical issue/);
  });

  it("writes critic-review.json on fail", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-bar.md"), "---\ntitle: Do bar\n---\nDo bar.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    setApiResponse({
      verdict: "fail",
      critical_issues: ["Incomplete"],
      warnings: [],
      summary: "Not done.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await expect((check as CodeCheck).run(makeContext(dir, runDir))).rejects.toThrow();

    const artifact = JSON.parse(readFileSync(join(runDir, "critic-review.json"), "utf8"));
    expect(artifact.verdict).toBe("fail");
    expect(artifact.critical_issues).toHaveLength(1);
  });

  it("passes with warnings and writes critic-review.json", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-baz.md"), "---\ntitle: Do baz\n---\nDo baz.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    setApiResponse({
      verdict: "pass_with_warnings",
      critical_issues: [],
      warnings: ["Could improve error messages"],
      summary: "Mostly complete.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir));

    expect(result).toMatch(/pass_with_warnings/);
    expect(result).toMatch(/1 warning/);

    const artifact = JSON.parse(readFileSync(join(runDir, "critic-review.json"), "utf8"));
    expect(artifact.verdict).toBe("pass_with_warnings");
    expect(artifact.warnings).toHaveLength(1);
  });
});
