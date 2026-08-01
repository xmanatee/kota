// Operator UI values are presentation fields, so bound both sanitizer work and emitted text.
export const MAX_TERMINAL_TEXT_RENDER_CODE_UNITS = 16_384;

const ESC = 0x1b;
const BEL = 0x07;
const C1_CSI = 0x9b;
const C1_ST = 0x9c;
const C1_OSC = 0x9d;
const TERMINAL_TEXT_TRUNCATION_MARKER = "…";

function isDiscardedControl(code: number): boolean {
  return code <= 0x09 ||
    (code >= 0x0b && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f);
}

function isBidiFormatControl(code: number): boolean {
  return code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069);
}

function skipOperatingSystemCommand(value: string, start: number, end: number): number {
  let index = start;
  while (index < end) {
    const code = value.charCodeAt(index);
    if (code === BEL || code === C1_ST) return index + 1;
    if (code === ESC && index + 1 < end && value.charCodeAt(index + 1) === 0x5c) {
      return index + 2;
    }
    index += 1;
  }
  return end;
}

function skipControlSequence(value: string, start: number, end: number): number {
  let index = start;
  while (index < end) {
    const code = value.charCodeAt(index);
    if (code < 0x30 || code > 0x3f) break;
    index += 1;
  }
  while (index < end) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x2f) break;
    index += 1;
  }
  if (index < end) {
    const code = value.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) return index + 1;
  }
  return index;
}

export function stripTerminalTextControls(value: string): string {
  const truncated = value.length > MAX_TERMINAL_TEXT_RENDER_CODE_UNITS;
  let scanEnd = truncated
    ? MAX_TERMINAL_TEXT_RENDER_CODE_UNITS - TERMINAL_TEXT_TRUNCATION_MARKER.length
    : value.length;
  if (
    truncated &&
    scanEnd > 0 &&
    value.charCodeAt(scanEnd - 1) >= 0xd800 &&
    value.charCodeAt(scanEnd - 1) <= 0xdbff &&
    value.charCodeAt(scanEnd) >= 0xdc00 &&
    value.charCodeAt(scanEnd) <= 0xdfff
  ) {
    scanEnd -= 1;
  }

  const output: string[] = [];
  let index = 0;
  while (index < scanEnd) {
    const code = value.charCodeAt(index);
    if (code === ESC) {
      if (index + 1 >= scanEnd) {
        index += 1;
      } else {
        const next = value.charCodeAt(index + 1);
        if (next === 0x5d) {
          index = skipOperatingSystemCommand(value, index + 2, scanEnd);
        } else if (next === 0x5b) {
          index = skipControlSequence(value, index + 2, scanEnd);
        } else {
          index += next >= 0x40 && next <= 0x5f ? 2 : 1;
        }
      }
      continue;
    }
    if (code === C1_OSC) {
      index = skipOperatingSystemCommand(value, index + 1, scanEnd);
      continue;
    }
    if (code === C1_CSI) {
      index = skipControlSequence(value, index + 1, scanEnd);
      continue;
    }
    if (isDiscardedControl(code) || isBidiFormatControl(code)) {
      index += 1;
      continue;
    }
    output.push(value[index]);
    index += 1;
  }
  if (truncated) output.push(TERMINAL_TEXT_TRUNCATION_MARKER);
  return output.join("");
}

export function safeTerminalLineText(value: string): string {
  return stripTerminalTextControls(value).replace(/\n+/g, " ");
}
