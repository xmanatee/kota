import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullTransport } from "#core/loop/transport.js";
import {
  initProviderRegistry,
  RENDERING_PROVIDER_TOKEN,
  resetProviderRegistry,
} from "./provider-registry.js";
import type { RenderingProvider, ReplChrome } from "./provider-types.js";
import {
  createTerminalDiagnosticNormalizer,
  printTerminalDiagnostic,
  stripTerminalDiagnosticControls,
  writeTerminalStderr,
} from "./terminal-renderer.js";

const noopChrome: ReplChrome = {
  announceHarness: () => {},
  showHelp: () => {},
  showStatus: () => {},
  showReset: () => {},
  showError: () => {},
  showGoodbye: () => {},
};

function installProvider(chunks: string[]): void {
  const provider: RenderingProvider = {
    createAgentTransport: () => new NullTransport(),
    createReplChrome: () => noopChrome,
    printDiagnostic: (diagnostic) => {
      chunks.push(
        diagnostic.detail === undefined
          ? `${diagnostic.level}:${diagnostic.message}`
          : `${diagnostic.level}:${diagnostic.message}:${diagnostic.detail}`,
      );
    },
    printPrompt: (prompt) => {
      chunks.push(prompt.kind);
    },
    writeStderr: (text) => {
      chunks.push(text);
    },
  };
  initProviderRegistry().register(RENDERING_PROVIDER_TOKEN, "test", provider);
}

describe("terminal renderer core seam", () => {
  let stderrChunks: string[];

  beforeEach(() => {
    resetProviderRegistry();
    stderrChunks = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetProviderRegistry();
  });

  it("falls back to stderr when no rendering provider is registered", () => {
    printTerminalDiagnostic("module failed", "error", "boom");
    writeTerminalStderr("raw passthrough");

    expect(stderrChunks).toEqual(["module failed\n", "boom\n", "raw passthrough"]);
  });

  it("uses the rendering provider when registered", () => {
    const providerChunks: string[] = [];
    installProvider(providerChunks);

    printTerminalDiagnostic("module failed", "warn", "boom");
    writeTerminalStderr("raw passthrough");

    expect(providerChunks).toEqual([
      "warn:module failed:boom",
      "raw passthrough",
    ]);
    expect(stderrChunks).toEqual([]);
  });

  it("normalizes split terminal commands with the same policy as complete diagnostics", () => {
    const cases = [
      ["hello\n世界🔑", "hello\n世界🔑"],
      ["a\x1b[31mb\x9b2Jc", "abc"],
      ["a\x1b]title\x07b\x9dtitle\x9cc\x1b]title\x1b\\d", "abcd"],
      ["a\x1b\x1b[31mb\x1bZc\x1b?d", "abc?d"],
      ["a\u202e\u2066\x00\x09\x7fb", "ab"],
      ["a\x1b", "a"],
      ["a\x1b[123", "a"],
      ["a\x1b]unfinished\x1b", "a"],
    ] as const;
    for (const [input, expected] of cases) {
      expect(stripTerminalDiagnosticControls(input)).toBe(expected);
      for (let split = 0; split <= input.length; split++) {
        const normalize = createTerminalDiagnosticNormalizer();
        expect(normalize(input.slice(0, split)) + normalize(input.slice(split), true)).toBe(expected);
        expect(normalize("after", true)).toBe("after");
      }
    }
  });

  it("sanitizes terminal controls before provider and fallback diagnostics", () => {
    const message = "peer\x1b]0;spoofed\x07error\x1b[2J\x9b31m\u202e";
    const detail = "remote\x9d0;spoofed\x9cname\x1b[31m\x9b32m\u2066";

    printTerminalDiagnostic(message, "error", detail);
    writeTerminalStderr(`${message}\n${detail}\n`);

    expect(stderrChunks).toEqual(["peererror\n", "remotename\n", "peererror\nremotename\n"]);

    stderrChunks.length = 0;
    const providerChunks: string[] = [];
    installProvider(providerChunks);

    printTerminalDiagnostic(message, "error", detail);
    writeTerminalStderr(`${message}\n${detail}\n`);

    expect(providerChunks).toEqual(["error:peererror:remotename", "peererror\nremotename\n"]);
    expect(stderrChunks).toEqual([]);
  });
});
