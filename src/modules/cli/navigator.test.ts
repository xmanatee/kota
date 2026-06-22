import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DaemonSseStreamEvent } from "#core/daemon/daemon-control.js";
import {
  NON_TTY_HINT,
  refuseNonTtyLaunch,
  runNavigator,
} from "./navigator.js";
import { emptyClient } from "./navigator-test-client.js";
import {
  makeOutput,
  makePrompt,
  navigationSurfaceBundle,
  surfaceBundle,
} from "./navigator-test-surfaces.js";

describe("runtime navigator", () => {
  it("refuses non-TTY launch and prints the equivalent one-shot hint", () => {
    let captured = "";
    const stderr = { write: (s: string) => { captured += s; return true; } } as unknown as NodeJS.WritableStream;
    refuseNonTtyLaunch(stderr);
    expect(captured.trim()).toBe(NON_TTY_HINT);
  });

  it("renders shared UI surfaces, opens a Work intent surface, and quits cleanly", async () => {
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => surfaceBundle()),
        executeAction: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, message: "stub" })),
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["work", "q"]),
      output: output.capture,
    });
    const joined = output.frames.join("\n");
    expect(joined).toMatch(/KOTA CLI client/);
    expect(joined).toMatch(/Daemon-backed shared UI client/);
    expect(joined).toMatch(/operator-control/);
    expect(joined).toMatch(/Operator Control/);
    expect(joined).toMatch(/Launch workflow run/);
    expect(joined).toMatch(/Live daemon events/);
    expect(joined).toMatch(/launch\.defaults\.configure/);
    expect(client.ui.listSurfaces).toHaveBeenCalledTimes(1);
  });

  it("refreshes the shared surface bundle on command", async () => {
    const listSurfaces = vi.fn(async () => surfaceBundle());
    const client = emptyClient({
      ui: {
        listSurfaces,
        executeAction: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, message: "stub" })),
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["refresh", "q"]),
      output: output.capture,
    });
    expect(listSurfaces).toHaveBeenCalledTimes(2);
    expect(output.frames.join("\n")).toMatch(/operator-control/);
  });

  it("renders command palette, resize, theme, and keybinding states", async () => {
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => surfaceBundle()),
        executeAction: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, message: "stub" })),
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt([":", "resize 120", "theme ascii", "keys", "q"]),
      output: output.capture,
    });
    const joined = output.frames.join("\n");
    expect(joined).toMatch(/Command palette/);
    expect(joined).toMatch(/Width set to 120/);
    expect(joined).toMatch(/Theme preference set to ascii/);
    expect(joined).toMatch(/Keybindings/);
  });

  it("drives keyboard focus and selected surface/action movement deterministically", async () => {
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => navigationSurfaceBundle()),
        executeAction: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, message: "stub" })),
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["j", "k", "j", "enter", "tab", "j", "k", "q"]),
      output: output.capture,
    });

    expect(output.frames[0]).toMatch(/focus:surfaces/);
    expect(output.frames[0]).toMatch(/>\s+1\s+status-panel/);
    expect(output.frames[1]).toMatch(/>\s+2\s+work-console/);
    expect(output.frames[2]).toMatch(/>\s+1\s+status-panel/);
    expect(output.frames[3]).toMatch(/>\s+2\s+work-console/);
    expect(output.frames[4]).toMatch(/Work Console/);
    expect(output.frames[4]).toMatch(/>\s+work\.first\s+First work action/);
    expect(output.frames[5]).toMatch(/focus:actions/);
    expect(output.frames[6]).toMatch(/>\s+work\.second\s+Second work action/);
    expect(output.frames[7]).toMatch(/>\s+work\.first\s+First work action/);
  });

  it("subscribes to live daemon UI events and refreshes the current frame", async () => {
    const listSurfaces = vi.fn(async () => surfaceBundle());
    async function* watchEvents(): AsyncIterable<DaemonSseStreamEvent> {
      yield {
        id: "evt-1",
        type: "workflow.started",
        payload: {
          projectId: "scope-main",
          workflow: "builder",
          runId: "run-1",
          triggerEvent: "manual",
          definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
          runDir: ".kota/runs/run-1",
          startedAt: "2026-06-19T00:00:00.000Z",
        },
      };
    }
    const client = emptyClient({
      ui: {
        listSurfaces,
        executeAction: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, message: "stub" })),
        watchEvents,
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: {
        ask: async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          return "q";
        },
        close: () => {},
      },
      output: output.capture,
    });
    const joined = output.frames.join("\n");
    expect(listSurfaces).toHaveBeenCalledTimes(2);
    expect(joined).toMatch(/Live update workflow\.started/);
    expect(joined).toMatch(/live:event-stream 1/);
  });

  it("executes a typed shared UI action with JSON parameters", async () => {
    const executeAction = vi.fn(async () => ({ ok: true as const, message: "Workflow queued." }));
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => surfaceBundle()),
        executeAction,
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(['action operator-control workflow.launch --yes {"name":"builder"}', "q"]),
      output: output.capture,
    });
    expect(executeAction).toHaveBeenCalledWith({
      surfaceId: "operator-control",
      actionId: "workflow.launch",
      parameters: { name: "builder" },
    });
    expect(output.frames.join("\n")).toMatch(/UI action executed/);
  });

  it("requires confirmation for write actions when --yes is absent", async () => {
    const executeAction = vi.fn(async () => ({ ok: true as const, message: "Workflow queued." }));
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => surfaceBundle()),
        executeAction,
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["action operator-control workflow.launch", "Launch run", "q"]),
      output: output.capture,
    });
    expect(executeAction).toHaveBeenCalledWith({
      surfaceId: "operator-control",
      actionId: "workflow.launch",
      parameters: undefined,
    });
    expect(output.frames.join("\n")).toMatch(/UI action executed/);
  });

  it("keeps disabled actions local instead of executing them", async () => {
    const executeAction = vi.fn(async () => ({ ok: true as const, message: "Updated." }));
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => surfaceBundle()),
        executeAction,
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["action operator-control launch.defaults.configure --yes {}", "q"]),
      output: output.capture,
    });
    expect(executeAction).not.toHaveBeenCalled();
    expect(output.frames.join("\n")).toMatch(/Configure launch defaults is disabled/);
  });

  it("never imports `.kota/` paths, module services, or private navigator data paths", () => {
    const sources = [
      readFileSync(join(import.meta.dirname, "navigator.ts"), "utf-8"),
      readFileSync(join(import.meta.dirname, "index.ts"), "utf-8"),
    ];
    for (const src of sources) {
      // The navigator must not bypass the KotaClient contract by reading
      // .kota/ on disk, opening its own DaemonControlClient, or pulling
      // module providers/services through ModuleContext.
      expect(/['"]\.kota\//.test(src), "navigator must not read .kota/ paths").toBe(false);
      expect(/DaemonControlClient/.test(src), "navigator must not import DaemonControlClient").toBe(false);
      expect(/getProvider|getModuleSummaries|getApprovalQueue|moduleServices/.test(src),
        "navigator must not resolve module services through ctx",
      ).toBe(false);
      expect(/client\.(approvals|tasks|workflow|sessions|modules|setup|secrets|memory|knowledge|history|ownerQuestions)\b/.test(src),
        "navigator must consume shared ui surfaces rather than private namespace projections",
      ).toBe(false);
    }
  });

  it("surfaces contract errors in place rather than swallowing them", async () => {
    const failingList = vi.fn(async () => {
      throw new Error("Daemon unreachable while listing shared UI surfaces");
    });
    const client = emptyClient({
      ui: {
        listSurfaces: failingList,
        executeAction: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, message: "stub" })),
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["work", "q"]),
      output: output.capture,
    });
    expect(output.frames.join("\n")).toMatch(/Daemon unreachable/);
  });
});
