/**
 * Rendering provider — the module-owned default implementation of
 * `RenderingProvider`. Core resolves operator-facing surfaces through
 * the provider registry without reaching into `#modules/rendering/*`
 * directly. This file is the
 * concrete binding between that seam and the rendering primitives and
 * transport.
 */

import type { Transport } from "#core/loop/transport.js";
import type {
  RenderingProvider,
  ReplChrome,
  TerminalDiagnostic,
  TerminalDiagnosticLevel,
  TerminalPrompt,
} from "#core/modules/provider-types.js";
import { CliTransport } from "./cli-transport.js";
import { blank, kvBlock, line, plain, prose, sectionRule, span, stack } from "./primitives.js";
import { TerminalTransport } from "./transport.js";

function roleForDiagnostic(level: TerminalDiagnosticLevel) {
  if (level === "error") return "error";
  if (level === "warn") return "warn";
  if (level === "debug") return "muted";
  return "info";
}

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
    showStatus(harness, model, turns, scopeRoot): void {
      chrome.write(
        line(
          span("Harness: ", "muted"),
          span(harness, "info"),
          plain("  "),
          span("Model: ", "muted"),
          span(model, "info"),
          plain("  "),
          ...(scopeRoot
            ? [
                span("Scope: ", "muted"),
                plain(scopeRoot),
                plain("  "),
              ]
            : []),
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
  const stderr = new TerminalTransport({ stream: process.stderr });

  return {
    createAgentTransport(options): Transport {
      return new CliTransport(options.verbose, options.showCost);
    },
    createReplChrome(): ReplChrome {
      return createStderrChrome();
    },
    printDiagnostic(diagnostic: TerminalDiagnostic): void {
      const role = roleForDiagnostic(diagnostic.level);
      stderr.write(
        diagnostic.detail
          ? stack(
              line(span(diagnostic.message, role)),
              line(span(diagnostic.detail, "muted")),
            )
          : line(span(diagnostic.message, role)),
      );
    },
    printPrompt(prompt: TerminalPrompt): void {
      if (prompt.kind === "question") {
        stderr.write(
          stack(
            blank(),
            sectionRule("Question"),
            line(span("[kota] Question", "accent", true)),
            prose(prompt.question),
            sectionRule(""),
          ),
        );
        stderr.writeRaw("> ");
        return;
      }

      const risk = prompt.risk.toUpperCase();
      const riskRole =
        prompt.risk === "high" ? "error" : prompt.risk === "medium" ? "warn" : "info";
      const details = prompt.details
        ? [kvBlock([{ label: "Details", value: prompt.details, role: "muted" }], 8)]
        : [];
      stderr.write(
        stack(
          blank(),
          sectionRule("Approval"),
          line(
            span("[kota] Approval requested ", "accent", true),
            span(`[${risk} risk]`, riskRole, true),
          ),
          prose(prompt.action),
          ...details,
          line(
            span("Timeout: ", "muted"),
            plain(`${prompt.timeoutSeconds}s`),
            span(" auto-rejects on expiry", "muted"),
          ),
          sectionRule(""),
        ),
      );
      stderr.writeRaw("Approve? [y/N] ");
    },
    writeStderr(text): void {
      stderr.writeRaw(text);
    },
  };
}
