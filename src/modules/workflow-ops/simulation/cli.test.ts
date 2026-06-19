import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { NO_COLOR_THEME } from "#modules/rendering/theme.js";
import {
  setTerminalTransport,
  TerminalTransport,
  type TransportStream,
} from "#modules/rendering/transport.js";
import { registerSimulationCommand } from "./cli.js";
import type {
  WorkflowSimulationRequest,
  WorkflowSimulationResult,
} from "./types.js";

function makeProgram(ctx: ModuleContext): Command {
  const program = new Command("workflow");
  program.exitOverride();
  registerSimulationCommand(program, ctx);
  return program;
}

function captureStdout(): { output: () => string; restore: () => void } {
  const chunks: string[] = [];
  const stream: TransportStream = {
    write(chunk: string): boolean {
      chunks.push(chunk);
      return true;
    },
    isTTY: false,
    columns: 100,
  };
  setTerminalTransport(new TerminalTransport({ stream, theme: NO_COLOR_THEME, width: 100 }));
  return {
    output: () => chunks.join(""),
    restore: () => setTerminalTransport(null),
  };
}

function simulationResult(
  overrides: Partial<WorkflowSimulationResult>,
): WorkflowSimulationResult {
  return {
    ok: true,
    request: {},
    inputs: [],
    summary: {
      total: 0,
      "would-ignore": 0,
      "would-batch": 0,
      "would-queue": 0,
      "would-block": 0,
      "would-ask-owner": 0,
      "would-dlq": 0,
      "would-perform-effect": 0,
      "would-noop": 0,
      unknown: 0,
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  setTerminalTransport(null);
  process.exitCode = undefined;
});

describe("workflow simulate command", () => {
  it("passes synthetic event input through the workflow client and renders text", async () => {
    const result = simulationResult({
      summary: {
        total: 1,
        "would-ignore": 1,
        "would-batch": 0,
        "would-queue": 0,
        "would-block": 0,
        "would-ask-owner": 0,
        "would-dlq": 0,
        "would-perform-effect": 0,
        "would-noop": 0,
        unknown: 0,
      },
      inputs: [
        {
          source: { kind: "synthetic" },
          event: "inbound.signal.received",
          outcome: "would-ignore",
          reasons: [
            {
              code: "source-ignored",
              severity: "blocker",
              event: "inbound.signal.received",
              message: "source status is archived",
            },
          ],
          matches: [],
          blockers: [],
          policyGates: [],
          effects: [],
          dryRuns: [],
          explain: {
            graph: {
              workflows: [],
              events: [],
              agents: [],
              automation: {
                workflows: [],
                events: [],
                blockers: [],
                downstream: [],
              },
            },
            query: {},
            outcome: "ignored",
            matches: [],
            reasons: [],
          },
        },
      ],
    });
    const simulate = vi.fn(async () => result);
    const ctx = {
      client: {
        workflow: {
          simulate,
        },
      },
    } as unknown as ModuleContext;
    const program = makeProgram(ctx);
    const capture = captureStdout();

    try {
      await program.parseAsync([
        "node",
        "workflow",
        "simulate",
        "sports-route",
        "--event",
        "inbound.signal.received",
        "--payload",
        JSON.stringify({ sourceStatus: "archived" }),
        "--event-id",
        "evt-1",
      ]);
    } finally {
      capture.restore();
    }

    expect(simulate).toHaveBeenCalledWith({
      workflowName: "sports-route",
      event: "inbound.signal.received",
      payload: { sourceStatus: "archived" },
      eventId: "evt-1",
    });
    expect(capture.output()).toContain("Automation Simulation");
    expect(capture.output()).toContain("Outcome: would-ignore");
  });

  it("loads committed fixtures and can list them", async () => {
    const simulate = vi.fn<
      (request: WorkflowSimulationRequest) => Promise<WorkflowSimulationResult>
    >(
      async () => simulationResult({}),
    );
    const ctx = {
      client: {
        workflow: {
          simulate,
        },
      },
    } as unknown as ModuleContext;
    const program = makeProgram(ctx);
    const capture = captureStdout();

    try {
      await program.parseAsync([
        "node",
        "workflow",
        "simulate",
        "--list-fixtures",
      ]);
    } finally {
      capture.restore();
    }

    expect(capture.output()).toContain("telegram-sports-ignored");
    expect(capture.output()).toContain("weekly-progress-review-journal-replay");

    const secondCapture = captureStdout();
    try {
      await program.parseAsync([
        "node",
        "workflow",
        "simulate",
        "--fixture",
        "telegram-sports-ignored",
        "--format",
        "json",
      ]);
    } finally {
      secondCapture.restore();
    }
    expect(simulate).toHaveBeenCalledOnce();
    expect(simulate.mock.calls[0]?.[0]).toMatchObject({
      event: "inbound.signal.received",
      eventId: "telegram-blocked-1",
    });
  });
});
