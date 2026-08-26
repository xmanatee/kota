import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReportCommand } from "./report-cli.js";

async function captureStdout(fn: () => Promise<void>): Promise<string> {
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

describe("kota report CLI process discipline output", () => {
  let workspaceRoot: string;
  let origCwd: string;
  let origEnvKotaScopeRoot: string | undefined;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-report-process-discipline-"));
    mkdirSync(join(workspaceRoot, ".kota", "runs"), { recursive: true });
    origCwd = process.cwd();
    origEnvKotaScopeRoot = process.env.KOTA_SCOPE_ROOT;
    delete process.env.KOTA_SCOPE_ROOT;
    process.chdir(workspaceRoot);
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (origEnvKotaScopeRoot !== undefined) {
      process.env.KOTA_SCOPE_ROOT = origEnvKotaScopeRoot;
    } else {
      delete process.env.KOTA_SCOPE_ROOT;
    }
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("--json includes the process-discipline report section", async () => {
    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "report", "--json"]);
    });

    const parsed = JSON.parse(out.trim());
    expect(parsed.processDiscipline).toMatchObject({
      rubricVersion: "process-discipline-v1",
      totalRecords: 0,
      groups: [],
    });
  });
});
