import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { NO_COLOR_THEME } from "#modules/rendering/theme.js";
import {
  setTerminalTransport,
  TerminalTransport,
  type TransportStream,
} from "#modules/rendering/transport.js";
import type { AutomationExplainResult } from "../graph/index.js";
import { registerExplainCommand } from "./explain.js";

function makeProgram(ctx: ModuleContext): Command {
  const program = new Command("workflow");
  program.exitOverride();
  registerExplainCommand(program, ctx);
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

function explainResult(
  overrides: Partial<AutomationExplainResult>,
): AutomationExplainResult {
  return {
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
    outcome: "unknown",
    matches: [],
    reasons: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  setTerminalTransport(null);
  process.exitCode = undefined;
});

describe("workflow explain command", () => {
  it("renders a channel-style explain result as text", async () => {
    const result = explainResult({
      query: {
        workflowName: "channel-match",
        eventName: "inbound.signal.received",
      },
      outcome: "ignored",
      matches: [],
      reasons: [
        {
          code: "source-ignored",
          severity: "blocker",
          event: "inbound.signal.received",
          message: "source status is blocked",
        },
      ],
      redactedSamplePayload: {
        scopeId: "scope-a",
        channel: "telegram",
        accessToken: "[redacted]",
      },
    });
    const explain = vi.fn(async () => result);
    const ctx = {
      client: {
        workflow: {
          explain,
        },
      },
    } as unknown as ModuleContext;
    const program = makeProgram(ctx);
    const capture = captureStdout();

    try {
      await program.parseAsync([
        "node",
        "workflow",
        "explain",
        "channel-match",
        "--event",
        "inbound.signal.received",
        "--payload",
        JSON.stringify({
          scopeId: "scope-a",
          channel: "telegram",
          accessToken: "secret-token",
        }),
        "--event-id",
        "evt-1",
      ]);
    } finally {
      capture.restore();
    }

    expect(explain).toHaveBeenCalledWith({
      workflowName: "channel-match",
      eventName: "inbound.signal.received",
      sampleEvent: {
        event: "inbound.signal.received",
        payload: {
          scopeId: "scope-a",
          channel: "telegram",
          accessToken: "secret-token",
        },
        eventId: "evt-1",
      },
    });
    const output = capture.output();
    expect(output).toContain("Automation Explain");
    expect(output).toContain("Workflow: channel-match");
    expect(output).toContain("Outcome: ignored");
    expect(output).toContain("[redacted]");
    expect(output).not.toContain("secret-token");
  });

  it("renders a code-hook-style explain result as JSON", async () => {
    const result = explainResult({
      query: { eventName: "code.hook.received" },
      outcome: "queued",
      matches: [
        {
          workflow: "apply-code-hook",
          triggerIndex: 0,
          triggerEvent: "code.hook.received",
          matchedFilter: true,
          effects: [],
          blockers: [],
          downstream: [],
        },
      ],
      reasons: [
        {
          code: "trigger-match",
          severity: "info",
          workflow: "apply-code-hook",
          event: "code.hook.received",
          triggerIndex: 0,
          message: "event matches trigger 0 for apply-code-hook",
        },
      ],
      redactedSamplePayload: {
        repository: "acme/repo",
        ref: "refs/heads/main",
        authorization: "[redacted]",
      },
    });
    const explain = vi.fn(async () => result);
    const ctx = {
      client: {
        workflow: {
          explain,
        },
      },
    } as unknown as ModuleContext;
    const program = makeProgram(ctx);
    const capture = captureStdout();

    try {
      await program.parseAsync([
        "node",
        "workflow",
        "explain",
        "--event",
        "code.hook.received",
        "--payload",
        JSON.stringify({
          repository: "acme/repo",
          ref: "refs/heads/main",
          authorization: "Bearer secret-token",
        }),
        "--format",
        "json",
      ]);
    } finally {
      capture.restore();
    }

    const output = capture.output();
    expect(output).toContain('"eventName": "code.hook.received"');
    expect(output).toContain('"workflow": "apply-code-hook"');
    expect(output).toContain("[redacted]");
    expect(output).not.toContain("secret-token");
  });
});
