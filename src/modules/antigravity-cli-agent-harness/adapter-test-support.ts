import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, vi } from "vitest";
import type { AgentHarnessResult } from "#core/agent-harness/index.js";

type AgyTestValue =
  | string
  | number
  | boolean
  | null
  | AgyTestValue[]
  | { [key: string]: AgyTestValue | undefined };

type AgyTestObject = { [key: string]: AgyTestValue | undefined };

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  sandboxLaunch: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, spawn: mocks.spawn };
});

vi.mock("#core/agent-harness/native-cli-sandbox.js", () => ({
  isNativeCliSandboxBootstrapError: (text: string) =>
    text.includes("sandbox-exec: sandbox_apply: Operation not permitted"),
  withNativeCliSandbox: mocks.sandboxLaunch,
}));

export function adapterTestMocks(): {
  spawnMock: ReturnType<typeof vi.fn>;
  sandboxLaunchMock: ReturnType<typeof vi.fn>;
} {
  return {
    spawnMock: mocks.spawn,
    sandboxLaunchMock: mocks.sandboxLaunch,
  };
}

export type MockChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

export function mockAgyProcess(options: {
  stdout?: string;
  stderr?: string;
  code?: number;
} = {}): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  mocks.spawn.mockReturnValue(child);

  queueMicrotask(() => {
    if (options.stdout) child.stdout.write(options.stdout);
    child.stdout.end();
    if (options.stderr) child.stderr.write(options.stderr);
    child.stderr.end();
    child.emit("close", options.code ?? 0, null);
  });
  return child;
}

export function successfulAgyOutput(text: string): string {
  return `${[
    { event: "init", conversation_id: "conversation-1" },
    {
      event: "step_update",
      step_update: {
        conversation_id: "conversation-1",
        step_type: "agent_response",
        text_delta: text,
      },
    },
    {
      event: "result",
      result: {
        conversation_id: "conversation-1",
        status: "SUCCESS",
        response: text,
        num_turns: 1,
        usage: { input_tokens: 12, output_tokens: 3 },
      },
    },
  ].map((event) => JSON.stringify(event)).join("\n")}\n`;
}

export function successfulStructuredAgyOutput(
  value: AgyTestObject,
): string {
  return `${JSON.stringify({
    event: "result",
    result: {
      conversation_id: "conversation-structured",
      status: "SUCCESS",
      response: JSON.stringify(value),
      structured_output: value,
      num_turns: 1,
      usage: { input_tokens: 20, output_tokens: 5 },
    },
  })}\n`;
}

export function successfulEmptyAgyOutput(): string {
  return `${JSON.stringify({
    event: "result",
    result: {
      conversation_id: "conversation-empty",
      status: "SUCCESS",
      num_turns: 1,
      usage: { input_tokens: 8, output_tokens: 0 },
    },
  })}\n`;
}

export function agyOutputAfterToolFailure(options: {
  detail: string;
  response?: string;
}): string {
  const events: AgyTestObject[] = [
    { event: "init", conversation_id: "conversation-tool-failure" },
    {
      event: "step_update",
      step_update: {
        conversation_id: "conversation-tool-failure",
        step_type: "tool",
        state: "ERROR",
        tool_name: "run_command",
        tool_info: {
          name: "run_command",
          error: { message: options.detail },
        },
      },
    },
  ];
  if (options.response !== undefined) {
    events.push({
      event: "step_update",
      step_update: {
        conversation_id: "conversation-tool-failure",
        step_type: "agent_response",
        text_delta: options.response,
      },
    });
  }
  events.push({
    event: "result",
    result: {
      conversation_id: "conversation-tool-failure",
      status: "SUCCESS",
      ...(options.response !== undefined ? { response: options.response } : {}),
      num_turns: 1,
      usage: { input_tokens: 20, output_tokens: 2 },
    },
  });
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

export function mockManualAgyProcess(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  mocks.spawn.mockReturnValue(child);
  return child;
}

beforeEach(() => {
  mocks.spawn.mockReset();
  mocks.sandboxLaunch.mockReset().mockImplementation(
    async (
      executable: string,
      args: readonly string[],
      options: { env: NodeJS.ProcessEnv },
      run: (process: {
        command: string;
        args: string[];
        env: NodeJS.ProcessEnv;
      }) => Promise<AgentHarnessResult>,
    ) => run({
      command: "authority-sandbox",
      args: [executable, ...args],
      env: options.env,
    }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});
