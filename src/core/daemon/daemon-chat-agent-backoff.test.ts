import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowAgentIncidentSignal } from "#core/workflow/trigger-types.js";
import { handleDaemonChat } from "./daemon-chat-handlers.js";
import { DaemonChatPool } from "./daemon-chat-pool.js";

const SCOPE_ID = "test-scope";

describe("daemon chat fleet agent boundary", () => {
  it.each([
    {
      label: "successful empty output",
      output: "",
      error: undefined,
      expectedKind: "output_contract",
    },
    {
      label: "a quota failure",
      output: undefined,
      error: "quota exhausted; resets in 2h",
      expectedKind: "rate_limit",
    },
  ])("registers and records $label before another agent can launch", async (scenario) => {
    const pool = new DaemonChatPool();
    const send = vi.fn(async () => {
      if (scenario.error !== undefined) throw new Error(scenario.error);
      return scenario.output;
    });
    const session = pool.create(
      () => ({
        send,
        cancelActiveTurn: vi.fn(),
        close: vi.fn(),
        getAutonomyMode: () => "passive" as const,
        setAutonomyMode: vi.fn(),
        getGuardrailsSnapshot: vi.fn(),
        replaceGuardrailsConfig: vi.fn(),
        clientApprovalResolver: undefined,
        setClientApprovalResolver: vi.fn(),
      }) as never,
      "passive",
      "conversation-1",
      { scopeId: SCOPE_ID },
    );
    const release = vi.fn();
    const registerAttempt = vi.fn(() => release);
    const applyIncident = vi.fn((signal: WorkflowAgentIncidentSignal) => ({
      runtimeId: "antigravity-cli:antigravity-cli",
      kind: signal.kind,
      failureCount: 1,
      until: "2026-09-02T20:00:00.000Z",
      updatedAt: "2026-09-02T18:00:00.000Z",
      reason: signal.reason,
    }));
    const req = Readable.from([
      Buffer.from(JSON.stringify({
        message: "Review the canary evidence.",
        agent_backoff: "fleet",
      })),
    ]);
    let status = 0;
    let responseText = "";
    const res = {
      writableEnded: false,
      destroyed: false,
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus;
      }),
      write: vi.fn((chunk: string) => {
        responseText += chunk;
        return true;
      }),
      end: vi.fn(() => {
        res.writableEnded = true;
      }),
    };

    await handleDaemonChat(pool, req as never, res as never, session.id, {
        registerAttempt,
        applyIncident,
      });

    expect(status).toBe(200);
    expect(responseText).toContain("event: error");
    expect(registerAttempt).toHaveBeenCalledWith(
      expect.any(AbortController),
      SCOPE_ID,
    );
    expect(registerAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0]!,
    );
    expect(applyIncident).toHaveBeenCalledWith(
      expect.objectContaining({ kind: scenario.expectedKind }),
      SCOPE_ID,
    );
    expect(release).toHaveBeenCalledOnce();
  });
});
