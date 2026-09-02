import { describe, expect, it, vi } from "vitest";
import { buildDaemonWorkflowHandle } from "./daemon-handle-workflows.js";

describe("daemon workflow pause handling", () => {
  it("routes quality pauses to agent backoff without setting global dispatch pause", () => {
    const pauseAgentForQuality = vi.fn(() => true);
    const setDispatchPaused = vi.fn();
    const handle = buildDaemonWorkflowHandle(
      { scopeRegistry: {} } as never,
      () => ({
        workflowRuntime: { pauseAgentForQuality, setDispatchPaused },
      }) as never,
      () => null,
    );

    expect(handle.pauseAgentDispatchForQuality!("unrelated edits")).toEqual({ already: false });
    expect(pauseAgentForQuality).toHaveBeenCalledWith("unrelated edits");
    expect(setDispatchPaused).not.toHaveBeenCalled();
  });

  it("persists operator intent when dispatch is only runtime-paused", () => {
    const setDispatchPaused = vi.fn();
    const handle = buildDaemonWorkflowHandle(
      { scopeRegistry: {} } as never,
      () => ({
        workflowRuntime: {
          getDispatchPauseStatus: () => ({
            paused: true,
            kind: "runtime",
            source: "runtime",
            message: "runtime pause",
            nextAction: "inspect",
          }),
          setDispatchPaused,
        },
      }) as never,
      () => null,
    );

    expect(handle.pauseWorkflowDispatch()).toEqual({ already: false });
    expect(setDispatchPaused).toHaveBeenCalledWith(true, "persistent");
  });

  it("does not rewrite an existing operator pause", () => {
    const setDispatchPaused = vi.fn();
    const handle = buildDaemonWorkflowHandle(
      { scopeRegistry: {} } as never,
      () => ({
        workflowRuntime: {
          getDispatchPauseStatus: () => ({
            paused: true,
            kind: "operator",
            source: "database",
            message: "operator pause",
            nextAction: "resume",
          }),
          setDispatchPaused,
        },
      }) as never,
      () => null,
    );

    expect(handle.pauseWorkflowDispatch()).toEqual({ already: true });
    expect(setDispatchPaused).not.toHaveBeenCalled();
  });
});
