import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initEventBus, resetEventBus } from "#core/events/event-bus.js";
import { buildDigestCommand } from "./digest-cli.js";
import { renderOnDemandDigest } from "./on-demand.js";

vi.mock("#core/daemon/owner-question-queue.js", async () => {
  const actual =
    await vi.importActual<
      typeof import("#core/daemon/owner-question-queue.js")
    >("#core/daemon/owner-question-queue.js");
  let queue: InstanceType<typeof actual.OwnerQuestionQueue> | null = null;
  return {
    ...actual,
    getOwnerQuestionQueue: (dir?: string) => {
      if (!queue) {
        queue = new actual.OwnerQuestionQueue(
          dir ?? join(process.cwd(), ".kota", "owner-questions"),
        );
      }
      return queue;
    },
    resetOwnerQuestionQueue: () => {
      queue = null;
    },
  };
});

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
  program.addCommand(buildDigestCommand());
  return program;
}

describe("kota digest CLI", () => {
  let projectDir: string;
  let origCwd: string;
  let origEnvKotaProjectDir: string | undefined;
  const observed: Array<{ event: string; payload: unknown }> = [];
  let unsubscribe: () => void;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-digest-cli-"));
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "ready"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "blocked"), { recursive: true });
    origCwd = process.cwd();
    origEnvKotaProjectDir = process.env.KOTA_PROJECT_DIR;
    delete process.env.KOTA_PROJECT_DIR;
    process.chdir(projectDir);

    // Pin Date.now so the seam-evaluated and CLI-evaluated windows match
    // exactly. Without this, two consecutive `renderOnDemandDigest` calls
    // pick different `windowEndMs` values and the structured JSON payloads
    // diverge by ~1ms.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T03:30:00.000Z"));

    observed.length = 0;
    const bus = initEventBus();
    const handler = (payload: unknown) => {
      observed.push({ event: "workflow.daily.digest", payload });
    };
    unsubscribe = bus.on("workflow.daily.digest", handler as never);

    const ownerMod = await import("#core/daemon/owner-question-queue.js");
    ownerMod.resetOwnerQuestionQueue();
    ownerMod.getOwnerQuestionQueue(join(projectDir, ".kota", "owner-questions"));
  });

  afterEach(() => {
    unsubscribe?.();
    resetEventBus();
    vi.useRealTimers();
    process.chdir(origCwd);
    if (origEnvKotaProjectDir !== undefined) {
      process.env.KOTA_PROJECT_DIR = origEnvKotaProjectDir;
    } else {
      delete process.env.KOTA_PROJECT_DIR;
    }
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("prints the same body renderOnDemandDigest produces", async () => {
    const expected = renderOnDemandDigest({
      projectDir,
      stateDir: join(projectDir, ".kota"),
    }).text;

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "digest"]);
    });

    expect(out).toBe(`${expected}\n`);
  });

  it("--json emits the structured DailyDigestData payload", async () => {
    const expected = renderOnDemandDigest({
      projectDir,
      stateDir: join(projectDir, ".kota"),
    }).data;

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "digest", "--json"]);
    });

    const parsed = JSON.parse(out.trim());
    expect(parsed).toEqual(expected);
  });

  it("does not create cadence state or emit workflow.daily.digest", async () => {
    const databasePath = join(projectDir, ".kota", "kota.sqlite");
    expect(existsSync(databasePath)).toBe(false);

    await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "digest"]);
      await makeProgram().parseAsync(["node", "kota", "digest", "--json"]);
    });

    expect(existsSync(databasePath)).toBe(false);
    expect(observed).toEqual([]);
  });
});
