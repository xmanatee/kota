import { getRenderingProvider } from "./provider-registry.js";
import type {
  TerminalDiagnostic,
  TerminalDiagnosticLevel,
  TerminalPrompt,
} from "./provider-types.js";

export function printTerminalDiagnostic(
  message: string,
  level: TerminalDiagnosticLevel = "info",
  detail?: string,
): void {
  const diagnostic: TerminalDiagnostic = { level, message };
  if (detail !== undefined) diagnostic.detail = detail;
  const provider = getRenderingProvider();
  if (provider) {
    provider.printDiagnostic(diagnostic);
    return;
  }
  writeFallbackDiagnostic(diagnostic);
}

export function printTerminalPrompt(prompt: TerminalPrompt): void {
  const provider = getRenderingProvider();
  if (!provider) {
    throw new Error("No rendering provider registered for interactive terminal prompt");
  }
  provider.printPrompt(prompt);
}

export function writeTerminalStderr(text: string): void {
  const provider = getRenderingProvider();
  if (provider) {
    provider.writeStderr(text);
    return;
  }
  process.stderr.write(text);
}

function writeFallbackDiagnostic(diagnostic: TerminalDiagnostic): void {
  writeTerminalStderr(`${diagnostic.message}\n`);
  if (diagnostic.detail !== undefined) {
    writeTerminalStderr(`${diagnostic.detail}\n`);
  }
}
