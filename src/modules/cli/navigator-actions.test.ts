import { describe, expect, it, vi } from "vitest";
import { runNavigator } from "./navigator.js";
import { operatorConsoleBundle } from "./navigator-operator-console-fixture.test-support.js";
import { emptyClient } from "./navigator-test-client.js";
import {
  makeOutput,
  makePrompt,
} from "./navigator-test-surfaces.test-support.js";

describe("runtime navigator shared UI actions", () => {
  it("executes the selected action from the actions pane and refreshes navigator state", async () => {
    const executeAction = vi.fn(async () => ({ ok: true as const, message: "Workflow dispatch paused." }));
    const listSurfaces = vi.fn(async () => operatorConsoleBundle());
    const client = emptyClient({
      ui: {
        listSurfaces,
        executeAction,
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["runs", "tab", "j", "enter", "Pause dispatch", "q"]),
      output: output.capture,
    });
    expect(executeAction).toHaveBeenCalledWith({
      surfaceId: "runs",
      actionId: "workflow.pause",
      parameters: undefined,
    });
    expect(listSurfaces).toHaveBeenCalledTimes(2);
    expect(output.frames.join("\n")).toMatch(/UI action executed: Workflow dispatch paused/);
  });

  it("targets the active run when the selected abort-run action has no explicit parameters", async () => {
    const executeAction = vi.fn(async () => ({ ok: true as const, message: "Run run-active-1 aborted." }));
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => operatorConsoleBundle()),
        executeAction,
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["runs", "tab", "j", "j", "j", "enter", "Abort run", "q"]),
      output: output.capture,
    });
    expect(executeAction).toHaveBeenCalledWith({
      surfaceId: "runs",
      actionId: "run.abort",
      parameters: { runId: "run-active-1" },
    });
    expect(output.frames.join("\n")).toMatch(/Run run-active-1 aborted/);
  });

  it("targets the first queued run when the selected cancel action has no explicit parameters", async () => {
    const executeAction = vi.fn(async () => ({ ok: true as const, message: "Queued run queued-run-1 cancelled." }));
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => operatorConsoleBundle()),
        executeAction,
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["runs", "tab", "j", "j", "j", "j", "enter", "Cancel queued run", "q"]),
      output: output.capture,
    });
    expect(executeAction).toHaveBeenCalledWith({
      surfaceId: "runs",
      actionId: "run.cancel-queued",
      parameters: { runId: "queued-run-1" },
    });
  });

  it("targets the first failed recent run when the selected retry action has no explicit parameters", async () => {
    const executeAction = vi.fn(async () => ({ ok: true as const, message: "Queued retry from run-failed-1." }));
    const client = emptyClient({
      ui: {
        listSurfaces: vi.fn(async () => operatorConsoleBundle()),
        executeAction,
        watchEvents: async function* () {},
      },
    });
    const output = makeOutput();
    await runNavigator({
      client,
      prompt: makePrompt(["runs", "tab", "j", "j", "j", "j", "j", "enter", "Retry run", "q"]),
      output: output.capture,
    });
    expect(executeAction).toHaveBeenCalledWith({
      surfaceId: "runs",
      actionId: "run.retry",
      parameters: { runId: "run-failed-1" },
    });
  });

});
