import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTerminalTransport } from "#modules/rendering/transport.js";
import { buildReportCommand } from "./report-cli.js";

const CSI_RED = "\x1b[31m";
const CSI_RESET = "\x1b[0m";
const OSC_TITLE = "\x1b]0;report-pwned\x07";
const C1_CSI_GREEN = "\x9b32m";
const RIGHT_TO_LEFT_OVERRIDE = "\u202e";
const RIGHT_TO_LEFT_MARK = "\u200f";
// biome-ignore lint/suspicious/noControlCharactersInRegex: regression checks assert raw terminal controls are absent
const RAW_TERMINAL_CONTROL_PATTERN = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/;
const UNICODE_BIDI_CONTROL_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((data: string | Uint8Array) => {
      chunks.push(
        typeof data === "string" ? data : Buffer.from(data).toString("utf-8"),
      );
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
  program.addCommand(buildReportCommand());
  return program;
}

function writeTask(projectDir: string, id: string): void {
  const dir = join(projectDir, "data", "tasks", "backlog");
  mkdirSync(dir, { recursive: true });
  const updatedAt = new Date("2026-07-07T12:00:00.000Z").toISOString();
  const content =
    `---\nid: ${id}\ntitle: ${id}\nstatus: backlog\npriority: p1\n` +
    `area: architecture\nsummary: t\ncreated_at: ${updatedAt}\n` +
    `updated_at: ${updatedAt}\n---\n\n## Problem\n\nTest body.\n`;
  writeFileSync(join(dir, `${id}.md`), content, "utf-8");
}

function writeApproval(projectDir: string): void {
  const dir = join(projectDir, ".kota", "approvals");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "approval-terminal-control.json"),
    `${JSON.stringify(
      {
        id: "approval-terminal-control",
        tool: `Bash${CSI_RED}red${CSI_RESET}${OSC_TITLE}${RIGHT_TO_LEFT_OVERRIDE}`,
        input: {},
        risk: `dangerous${C1_CSI_GREEN}green${RIGHT_TO_LEFT_MARK}`,
        reason: "fixture",
        createdAt: new Date("2026-07-07T12:00:00.000Z").toISOString(),
        status: "pending",
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

async function captureNoColorStdout(
  fn: () => Promise<void> | void,
): Promise<string> {
  const originalTheme = process.env.KOTA_RENDERER_THEME;
  process.env.KOTA_RENDERER_THEME = "no-color";
  setTerminalTransport(null);
  try {
    return await captureStdout(fn);
  } finally {
    if (originalTheme === undefined) {
      delete process.env.KOTA_RENDERER_THEME;
    } else {
      process.env.KOTA_RENDERER_THEME = originalTheme;
    }
    setTerminalTransport(null);
  }
}

describe("kota report CLI supervision load", () => {
  let projectDir: string;
  let origCwd: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-report-cli-load-"));
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
    origCwd = process.cwd();
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("renders the supervision-load section", async () => {
    writeTask(projectDir, "task-arch-1");

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "report"]);
    });

    expect(out).toContain("Supervision load");
    expect(out).toContain("Status:");
    expect(out).toContain("active runs");
  });

  it("--json emits the structured supervision-load payload", async () => {
    writeTask(projectDir, "task-arch-1");

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "report", "--json"]);
    });

    const parsed = JSON.parse(out.trim());
    expect(parsed.supervisionLoad).toMatchObject({
      status: "unknown",
      counts: {
        activeRuns: 0,
        activeTaskClaims: null,
        pendingApprovals: null,
        pendingOwnerQuestions: null,
        openDeadLetters: null,
      },
      thresholds: {
        busyAt: 3,
        overloadedAt: 6,
      },
    });
    expect(parsed.supervisionLoad.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "task-claims", status: "missing" }),
        expect.objectContaining({ source: "approvals", status: "missing" }),
        expect.objectContaining({
          source: "owner-questions",
          status: "missing",
        }),
        expect.objectContaining({ source: "dead-letters", status: "missing" }),
      ]),
    );
  });

  it("strips terminal controls from approval-derived top references", async () => {
    writeTask(projectDir, "task-arch-1");
    writeApproval(projectDir);

    const out = await captureNoColorStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "report"]);
    });

    expect(out).toContain("approval-terminal-control");
    expect(out).toContain("Bashred approval (dangerousgreen)");
    expect(out).not.toContain(CSI_RED);
    expect(out).not.toContain(OSC_TITLE);
    expect(out).not.toMatch(RAW_TERMINAL_CONTROL_PATTERN);
    expect(out).not.toMatch(UNICODE_BIDI_CONTROL_PATTERN);
  });
});
