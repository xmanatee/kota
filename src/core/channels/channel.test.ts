import { describe, expect, it } from "vitest";
import type {
  ChannelDef,
  ChannelStartContext,
  ChannelStartResult,
} from "./channel.js";

const STUB_START_CTX: ChannelStartContext = {
  projectDir: "/tmp/test",
  defaultProjectRuntime: {
    project: { projectId: "test-project", projectDir: "/tmp/test", displayName: "test" },
  } as never,
  getProjectRuntime: () =>
    ({
      project: { projectId: "test-project", projectDir: "/tmp/test", displayName: "test" },
    }) as never,
  log: () => {},
  getWorkflowStatus: () => ({
    runtimeState: { completedRuns: 0, pendingRuns: [], workflows: {} },
    dispatchPaused: false,
    runsDir: "/tmp/.kota/runs",
  }),
};

describe("ChannelStartResult discriminated union", () => {
  it("started result carries an adapter that exposes start and stop", () => {
    const def: ChannelDef = {
      name: "started-fixture",
      create() {
        return {
          status: "started",
          adapter: {
            async start() {},
            stop() {},
          },
        };
      },
    };
    const result: ChannelStartResult = def.create(STUB_START_CTX);
    expect(result.status).toBe("started");
    if (result.status === "started") {
      expect(typeof result.adapter.start).toBe("function");
      expect(typeof result.adapter.stop).toBe("function");
    }
  });

  it("disabled result carries a reason", () => {
    const def: ChannelDef = {
      name: "disabled-fixture",
      create() {
        return {
          status: "disabled",
          reason: "operator-disabled-via-config",
        };
      },
    };
    const result = def.create(STUB_START_CTX);
    expect(result.status).toBe("disabled");
    if (result.status === "disabled") {
      expect(result.reason).toBe("operator-disabled-via-config");
    }
  });

  it("unavailable result carries a missing-capability reason", () => {
    const def: ChannelDef = {
      name: "unavailable-fixture",
      create() {
        return {
          status: "unavailable",
          reason: "credentials missing",
        };
      },
    };
    const result = def.create(STUB_START_CTX);
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("credentials missing");
    }
  });

  it("failed result carries an error string", () => {
    const def: ChannelDef = {
      name: "failed-fixture",
      create() {
        return { status: "failed", error: "boom" };
      },
    };
    const result = def.create(STUB_START_CTX);
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toBe("boom");
    }
  });
});
