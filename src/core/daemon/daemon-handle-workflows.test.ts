import { describe, expect, it, vi } from "vitest";
import { buildDaemonWorkflowHandle } from "./daemon-handle-workflows.js";

describe("daemon workflow pause handling", () => {
  it("persists operator intent when dispatch is only runtime-paused", () => {
    const setDispatchPaused = vi.fn();
    const handle = buildDaemonWorkflowHandle(
      { projectRegistry: {} } as never,
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
      { projectRegistry: {} } as never,
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
