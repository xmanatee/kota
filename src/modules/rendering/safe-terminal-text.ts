const TERMINAL_ESCAPE_SEQUENCE_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: untrusted terminal text can contain raw controls
  /(?:\x1b\][\s\S]*?(?:\x07|\x1b\\|\x9c))|(?:\x9d[\s\S]*?(?:\x07|\x1b\\|\x9c))|(?:\x1b\[[0-?]*[ -/]*[@-~])|(?:\x9b[0-?]*[ -/]*[@-~])|(?:\x1b[@-_])/g;

const UNICODE_BIDI_FORMAT_CONTROL_PATTERN =
  /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function stripTerminalTextControls(value: string): string {
  return value
    .replace(TERMINAL_ESCAPE_SEQUENCE_PATTERN, "")
    .replace(UNICODE_BIDI_FORMAT_CONTROL_PATTERN, "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: untrusted terminal text can contain raw controls
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "");
}

export function safeTerminalLineText(value: string): string {
  return stripTerminalTextControls(value).replace(/\n+/g, " ");
}
