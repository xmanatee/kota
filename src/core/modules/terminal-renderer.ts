import { getRenderingProvider } from "./provider-registry.js";
import type {
  TerminalDiagnostic,
  TerminalDiagnosticLevel,
  TerminalPrompt,
} from "./provider-types.js";

const ESCAPE = 0x1b;
const BELL = 0x07;
const CONTROL_SEQUENCE_INTRODUCER = 0x9b;
const OPERATING_SYSTEM_COMMAND = 0x9d;
const STRING_TERMINATOR = 0x9c;

function isBidiFormatControl(code: number): boolean {
  return code === 0x061c
    || code === 0x200e
    || code === 0x200f
    || (code >= 0x202a && code <= 0x202e)
    || (code >= 0x2066 && code <= 0x2069);
}

function isOtherTerminalControl(code: number): boolean {
  return code <= 0x09
    || (code >= 0x0b && code <= 0x1f)
    || (code >= 0x7f && code <= 0x9f)
    || isBidiFormatControl(code);
}

/** Strip controls incrementally without retaining arbitrary CSI/OSC payloads. */
export function createTerminalDiagnosticNormalizer(): (chunk: string, final?: boolean) => string {
  let state: "text" | "escape" | "csi" | "osc" | "osc-escape" = "text";
  return (chunk, final = false) => {
    let safe = "";
    for (const char of chunk) {
      const code = char.charCodeAt(0);
      switch (state) {
        case "osc":
        case "osc-escape":
          if (code === BELL || code === STRING_TERMINATOR || (state === "osc-escape" && char === "\\")) {
            state = "text";
          } else {
            state = code === ESCAPE ? "osc-escape" : "osc";
          }
          continue;
        case "csi":
          if (code >= 0x40 && code <= 0x7e) state = "text";
          continue;
        case "escape":
          state = "text";
          if (char === "]") {
            state = "osc";
            continue;
          }
          if (char === "[") {
            state = "csi";
            continue;
          }
          if (code >= 0x40 && code <= 0x5f) continue;
          // An unrecognized escape drops only ESC; process this character normally.
          break;
        case "text":
          break;
      }
      if (code === ESCAPE) state = "escape";
      else if (code === OPERATING_SYSTEM_COMMAND) state = "osc";
      else if (code === CONTROL_SEQUENCE_INTRODUCER) state = "csi";
      else if (!isOtherTerminalControl(code)) safe += char;
    }
    // Incomplete terminal commands have no printable tail, including at EOF.
    if (final) state = "text";
    return safe;
  };
}

export function stripTerminalDiagnosticControls(value: string): string {
  return createTerminalDiagnosticNormalizer()(value, true);
}

export function createTerminalDiagnostic(
  message: string,
  level: TerminalDiagnosticLevel = "info",
  detail?: string,
): TerminalDiagnostic {
  const diagnostic: TerminalDiagnostic = {
    level,
    message: stripTerminalDiagnosticControls(message),
  };
  if (detail !== undefined) {
    diagnostic.detail = stripTerminalDiagnosticControls(detail);
  }
  return diagnostic;
}

export function printTerminalDiagnostic(
  message: string,
  level: TerminalDiagnosticLevel = "info",
  detail?: string,
): void {
  const diagnostic = createTerminalDiagnostic(message, level, detail);
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
  // Sanitize diagnostic input before either sink; provider-owned styling is
  // applied separately by the renderer and never passes through this boundary.
  const safe = stripTerminalDiagnosticControls(text);
  const provider = getRenderingProvider();
  if (provider) {
    provider.writeStderr(safe);
    return;
  }
  process.stderr.write(safe);
}

function writeFallbackDiagnostic(diagnostic: TerminalDiagnostic): void {
  writeTerminalStderr(`${diagnostic.message}\n`);
  if (diagnostic.detail !== undefined) {
    writeTerminalStderr(`${diagnostic.detail}\n`);
  }
}
