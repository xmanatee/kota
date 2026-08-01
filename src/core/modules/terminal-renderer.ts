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

function skipOperatingSystemCommand(value: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === BELL || code === STRING_TERMINATOR) return index + 1;
    if (code === ESCAPE && value.charCodeAt(index + 1) === 0x5c) return index + 2;
  }
  return value.length;
}

function skipControlSequence(value: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) return index + 1;
  }
  return value.length;
}

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

function stripTerminalDiagnosticControls(value: string): string {
  let safe = "";
  for (let index = 0; index < value.length;) {
    const code = value.charCodeAt(index);
    if (code === ESCAPE) {
      const next = value.charCodeAt(index + 1);
      if (next === 0x5d) {
        index = skipOperatingSystemCommand(value, index + 2);
      } else if (next === 0x5b) {
        index = skipControlSequence(value, index + 2);
      } else {
        index += next >= 0x40 && next <= 0x5f ? 2 : 1;
      }
      continue;
    }
    if (code === OPERATING_SYSTEM_COMMAND) {
      index = skipOperatingSystemCommand(value, index + 1);
      continue;
    }
    if (code === CONTROL_SEQUENCE_INTRODUCER) {
      index = skipControlSequence(value, index + 1);
      continue;
    }
    if (!isOtherTerminalControl(code)) safe += value[index];
    index += 1;
  }
  return safe;
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
