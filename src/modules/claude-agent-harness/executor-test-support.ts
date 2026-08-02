import type {
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
} from "node:child_process";
import { beforeEach, type Mock, vi } from "vitest";
import type { SDKQueryFn } from "./sdk-types.js";

/**
 * Shape of the raw frames the SDK iterator yields. The executor consumes
 * SDKMessage values internally and normalizes them to KotaAgentMessage at
 * the `onMessage` callback boundary; tests work in the SDK shape so they
 * exercise the executor's own normalization.
 */
type RawSdkTestValue =
  | string
  | number
  | boolean
  | null
  | RawSdkTestValue[]
  | { [key: string]: RawSdkTestValue | undefined };

export type RawSdkTestMessage = {
  type: string;
  [key: string]: RawSdkTestValue | undefined;
};

export const mockQuery: Mock = vi.fn();
export const mockSpawn: Mock = vi.fn();
export const mockSpawnSync: Mock = vi.fn();

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: Parameters<SDKQueryFn>) => mockQuery(...args),
}));

vi.mock("node:child_process", () => ({
  spawn: (...args: Parameters<typeof nodeSpawn>) => mockSpawn(...args),
  spawnSync: (...args: Parameters<typeof nodeSpawnSync>) => mockSpawnSync(...args),
}));

export function makeIterable(
  messages: RawSdkTestMessage[],
): AsyncIterable<RawSdkTestMessage> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message;
    },
  };
}

export function makeWriter() {
  const chunks: string[] = [];
  return {
    write(text: string) {
      chunks.push(text);
      return true;
    },
    get text() {
      return chunks.join("");
    },
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockSpawn.mockReset();
  mockSpawnSync.mockReset();
  mockSpawnSync.mockReturnValue({ status: 1, stdout: "" });
  delete process.env.CLAUDE_CODE_EXECUTABLE;
});
