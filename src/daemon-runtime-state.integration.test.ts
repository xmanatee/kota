import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import { Scheduler } from "#core/daemon/index.js";
import { getDaemonTransport } from "#core/server/daemon-transport.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import {
  makeDaemon,
  mockedExecuteWithAgentSDK,
  scopeRoot,
  stateDir,
  wait,
} from "./daemon-test-support.integration.js";

describe("Daemon runtime state", () => {
  it("records completed autonomous runs in daemon state", async () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );
    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      sessionId: "sess-1",
      turns: 2,
      usage: UNKNOWN_AGENT_USAGE,
      subtype: "success",
      isError: false,
    });

    const daemon = makeDaemon({
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          repository: "read",
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
            },
          ],
        }),
      ],
    });
    const startPromise = daemon.start();
    await daemon.whenReady();
    const deadline = Date.now() + 5_000;
    while (daemon.getDashboardSnapshot().completedRuns < 1 && Date.now() < deadline) {
      await wait(20);
    }

    const state = daemon.getDashboardSnapshot();
    expect(state.completedRuns).toBeGreaterThanOrEqual(1);
    expect(state.lastCompletedWorkflow).toBe("builder");
    expect(state.lastCompletedStatus).toBe("success");

    await daemon.stop();
    await startPromise;
  });

  it("persists reminders and delivers them through the daemon event stream", async () => {
    const daemon = makeDaemon({ pollIntervalMs: 100, workflows: [] });
    const startPromise = daemon.start();
    await daemon.whenReady();
    const database = RunStateDatabase.openExisting(stateDir);
    const abort = new AbortController();
    try {
      const transport = getDaemonTransport(stateDir);
      if (!transport) throw new Error("Daemon transport unavailable");
      // Await the real HTTP handshake before adding an already-due reminder.
      const response = await transport.fetchRaw("/events", {
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5_000)]),
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const scopeId = daemon.getScopeRegistryProjection().defaultScopeId;
      // A second scheduler must share state with the hosted scope runtime.
      const scheduler = new Scheduler({ database, scopeId });
      const due = new Date(Date.now() - 1000);
      const item = scheduler.add("Test reminder", due);
      const decoder = new TextDecoder();
      let wire = "";
      let frame: string | undefined;
      while (!frame) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("Daemon stream ended before reminder delivery");
        wire += decoder.decode(chunk.value, { stream: true });
        frame = wire.split("\n\n").slice(0, -1).find((value) => value.includes("event: schedule.fire\n"));
      }
      expect(frame).toMatch(/^id: .+/);
      expect(JSON.parse(frame.split("\ndata: ")[1])).toMatchObject({
        scopeId, itemId: item.id, description: "Test reminder", scheduledFor: due.toISOString(),
      });
      expect(new Scheduler({ database, scopeId }).list().find((entry) => entry.id === item.id)?.status).toBe("fired");
    } finally {
      abort.abort();
      await daemon.stop();
      await startPromise;
      database.close();
    }
  });

});
