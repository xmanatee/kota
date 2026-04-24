/**
 * Rendering provider — the module-owned default implementation of
 * `RenderingProvider`. Core resolves operator-facing surfaces through
 * the provider registry (see
 * `src/core/modules/no-rendering-imports-in-core.test.ts`); this file
 * is the concrete binding between that seam and the rendering
 * primitives and transport.
 */

import type { Transport } from "#core/loop/transport.js";
import type {
  RenderingProvider,
  ReplChrome,
} from "#core/modules/provider-types.js";
import { CliTransport } from "./cli-transport.js";
import { blank, line, plain, span } from "./primitives.js";
import { TerminalTransport } from "./transport.js";

function createStderrChrome(): ReplChrome {
  const chrome = new TerminalTransport({ stream: process.stderr });

  return {
    announceHarness(harness, model): void {
      chrome.write(
        line(
          span("kota ", "muted"),
          span(`[${harness.name}]`, "accent"),
          span(" ", "muted"),
          span(model, "info"),
          plain("  "),
          span("interactive", "muted"),
        ),
      );
      chrome.write(line(span(harness.description, "muted")));
      chrome.write(blank());
    },
    showHelp(commands): void {
      for (const [cmd, desc] of Object.entries(commands)) {
        chrome.write(
          line(span(`  ${cmd.padEnd(10)}`, "accent"), plain(` ${desc}`)),
        );
      }
      chrome.write(
        line(span("  exit      ", "accent"), plain(" Quit interactive mode")),
      );
    },
    showStatus(harness, model, turns): void {
      chrome.write(
        line(
          span("Harness: ", "muted"),
          span(harness, "info"),
          plain("  "),
          span("Model: ", "muted"),
          span(model, "info"),
          plain("  "),
          span("Turns: ", "muted"),
          plain(String(turns)),
        ),
      );
    },
    showReset(): void {
      chrome.write(line(span("Transcript cleared.", "success")));
    },
    showError(message): void {
      chrome.write(line(span(`Error: ${message}`, "error")));
    },
    showGoodbye(): void {
      chrome.write(blank());
      chrome.write(line(span("Goodbye.", "muted")));
    },
  };
}

export function createRenderingProvider(): RenderingProvider {
  return {
    createAgentTransport(options): Transport {
      return new CliTransport(options.verbose, options.showCost);
    },
    createReplChrome(): ReplChrome {
      return createStderrChrome();
    },
  };
}
