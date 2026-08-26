import { describe, expect, it, vi } from "vitest";
import type { ChannelAdapter, ChannelDef, ChannelStatus } from "#core/channels/channel.js";
import { startChannel } from "./daemon-channel-start.js";

describe("startChannel", () => {
  it("lets started channels report later background failure", async () => {
    let reportFailure!: (error: string) => void;
    const channel: ChannelDef = {
      name: "test-channel",
      create(ctx) {
        reportFailure = ctx.reportFailure;
        return {
          status: "started",
          adapter: {
            async start() {},
            stop() {},
            listScopeSessionIds: () => [],
          },
        };
      },
    };
    const statuses: ChannelStatus[] = [];
    const activeChannels: ChannelAdapter[] = [];
    const log = vi.fn();

    await startChannel(
      channel,
      {
        getDefaultScopeRuntime: () => ({} as never),
        getScopeRuntime: () => ({} as never),
        log: () => {},
        getWorkflowStatus: () => ({
          runtimeState: { activeRuns: [], completedRuns: 0, pendingRuns: [], workflows: {} },
          dispatchPaused: false,
          runsDir: "/tmp/project/.kota/runs",
        }),
      },
      statuses,
      activeChannels,
      log,
    );

    expect(statuses).toEqual([{ name: "test-channel", status: "started" }]);
    reportFailure("background loop exited");

    expect(statuses).toEqual([
      { name: "test-channel", status: "failed", error: "background loop exited" },
    ]);
    expect(log).toHaveBeenCalledWith(
      "Channel failed: test-channel: background loop exited",
    );
  });
});
