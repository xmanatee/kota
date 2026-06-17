import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullTransport } from "#core/loop/transport.js";
import {
  initProviderRegistry,
  RENDERING_PROVIDER_TOKEN,
  resetProviderRegistry,
} from "./provider-registry.js";
import type { RenderingProvider, ReplChrome } from "./provider-types.js";
import {
  printTerminalDiagnostic,
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
});
