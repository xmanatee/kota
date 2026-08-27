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
  let workspaceRoot: string;
  let origCwd: string;
  let origEnvKotaScopeRoot: string | undefined;
  const observed: Array<{ event: string; payload: unknown }> = [];
  let unsubscribe: () => void;

  beforeEach(async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-digest-cli-"));
    mkdirSync(join(workspaceRoot, ".kota", "runs"), { recursive: true });
    mkdirSync(join(workspaceRoot, "data", "tasks", "archive"), { recursive: true });
    origCwd = process.cwd();
    origEnvKotaScopeRoot = process.env.KOTA_SCOPE_ROOT;
    delete process.env.KOTA_SCOPE_ROOT;
    process.chdir(workspaceRoot);

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
    ownerMod.getOwnerQuestionQueue(join(workspaceRoot, ".kota", "owner-questions"));
  });

  afterEach(() => {
    unsubscribe?.();
    resetEventBus();
    vi.useRealTimers();
    process.chdir(origCwd);
    if (origEnvKotaScopeRoot !== undefined) {
      process.env.KOTA_SCOPE_ROOT = origEnvKotaScopeRoot;
    } else {
      delete process.env.KOTA_SCOPE_ROOT;
    }
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("prints the same body renderOnDemandDigest produces", async () => {
    const expected = renderOnDemandDigest({
      scopeRoot: workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
    }).text;

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "digest"]);
    });

    expect(out).toBe(`${expected}\n`);
  });

  it("--json emits the structured DailyDigestData payload", async () => {
    const expected = renderOnDemandDigest({
      scopeRoot: workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
    }).data;

    const out = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "digest", "--json"]);
    });

    const parsed = JSON.parse(out.trim());
    expect(parsed).toEqual(expected);
  });

  it("does not create cadence state or emit workflow.daily.digest", async () => {
    const databasePath = join(workspaceRoot, ".kota", "kota.sqlite");
    expect(existsSync(databasePath)).toBe(false);

    await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "digest"]);
      await makeProgram().parseAsync(["node", "kota", "digest", "--json"]);
    });

    expect(existsSync(databasePath)).toBe(false);
    expect(observed).toEqual([]);
  });
});
