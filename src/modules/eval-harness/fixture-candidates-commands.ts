import {
  isJsonObject,
  parseString,
  parseStringArray,
} from "./fixture-candidates-json.js";
import type {
  FixtureCandidateCommand,
  FixtureCandidateReasonCode,
  JsonValue,
} from "./fixture-candidates-types.js";

const COMMAND_EXCERPT_LIMIT = 220;
const TEXT_SCAN_LIMIT = 6000;
const COMMAND_START =
  /^(?:pnpm|npm|node|tsx|npx|vitest|biome|tsc|git|kota|python|python3|bun|deno|cargo|go|make|curl|wget|gh|ssh|scp|rsync|docker|rm|chmod|sudo|kill)\b/;
const COMMAND_INLINE =
  /\b(?:pnpm|npm|node|tsx|npx|vitest|biome|tsc|git|kota|python3?|bun|deno|cargo|go test|make|curl|wget|gh|ssh|scp|rsync|docker|rm|chmod|sudo|kill)\b[^\n`"]*/g;
const SECRET_ENV =
  /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API[_-]?KEY|AUTH|CREDENTIAL)[A-Z0-9_]*)=([^\s"'`]+)/gi;
const BEARER_SECRET = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g;
const GENERIC_SECRET_URL =
  /\b(access_token|api_key|token|password|secret)=([^&\s]+)/gi;

export const NETWORK_COMMAND =
  /\b(?:curl|wget|gh|ssh|scp|rsync)\b|\bgit\s+clone\b|\b(?:pnpm|npm|pip|brew|cargo)\s+(?:install|add)\b|https?:\/\//i;
export const AUTH_WALLED =
  /\b(?:gh\s+auth|storageState|login|oauth|bearer|api[_-]?key|access_token)\b/i;
export const HOST_SPECIFIC =
  /\/Users\/|\/Volumes\/|\/private\/|\/tmp\/|localhost:\d+|127\.0\.0\.1:\d+|\b(?:open|pbcopy|osascript)\b/i;
export const VERIFY_COMMAND =
  /\b(?:test|vitest|biome|lint|typecheck|tsc|validate|build|check|probe)\b/i;

const DESTRUCTIVE_COMMAND =
  /\brm\s+-rf\b|\bgit\s+reset\s+--hard\b|\bsudo\b|\bchmod\s+-R\s+777\b|\bdocker\s+(?:system\s+prune|rm|rmi)\b|\bkill\s+-9\b/i;

export function redactSensitive(text: string): { text: string; count: number } {
  let count = 0;
  const redact = (value: string): string => {
    count += 1;
    return value;
  };
  let redacted = text.replace(SECRET_ENV, (_match, key: string) =>
    redact(`${key}=[REDACTED]`),
  );
  redacted = redacted.replace(BEARER_SECRET, () => redact("Bearer [REDACTED]"));
  redacted = redacted.replace(GENERIC_SECRET_URL, (_match, key: string) =>
    redact(`${key}=[REDACTED]`),
  );
  return { text: redacted, count };
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, COMMAND_EXCERPT_LIMIT);
}

function commandRisks(command: string): FixtureCandidateReasonCode[] {
  const risks: FixtureCandidateReasonCode[] = [];
  if (DESTRUCTIVE_COMMAND.test(command)) risks.push("safety-destructive-command");
  if (NETWORK_COMMAND.test(command)) risks.push("reproducibility-network-bound");
  if (AUTH_WALLED.test(command)) risks.push("reproducibility-auth-walled");
  if (HOST_SPECIFIC.test(command)) risks.push("reproducibility-host-specific");
  if (redactSensitive(command).count > 0) risks.push("privacy-secret-like-value");
  return risks;
}

export function addCommand(
  commands: FixtureCandidateCommand[],
  seen: Set<string>,
  source: string,
  kind: FixtureCandidateCommand["kind"],
  rawCommand: string,
): void {
  const command = compactText(redactSensitive(rawCommand).text);
  if (command.length === 0 || seen.has(command)) return;
  seen.add(command);
  commands.push({ source, kind, command, risk: commandRisks(rawCommand) });
}

function commandLikeLine(lineText: string): string | null {
  const trimmed = lineText.trim().replace(/^\$+\s*/, "");
  if (COMMAND_START.test(trimmed)) return trimmed;
  const withoutEnv = trimmed.replace(
    /^(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+[\t ]+)+/,
    "",
  );
  if (withoutEnv !== trimmed && COMMAND_START.test(withoutEnv)) return trimmed;
  return null;
}

export function collectCommandsFromText(
  text: string,
  source: string,
  commands: FixtureCandidateCommand[],
  seen: Set<string>,
): void {
  const boundedText = text.slice(0, TEXT_SCAN_LIMIT);
  for (const lineText of boundedText.split("\n")) {
    const command = commandLikeLine(lineText);
    if (command !== null) addCommand(commands, seen, source, "shell", command);
  }
  for (const match of boundedText.matchAll(COMMAND_INLINE)) {
    addCommand(commands, seen, source, "shell", match[0]);
  }
}

export function collectCommandsFromJson(
  value: JsonValue | undefined,
  source: string,
  commands: FixtureCandidateCommand[],
  seen: Set<string>,
): void {
  if (typeof value === "string") {
    collectCommandsFromText(value, source, commands, seen);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectCommandsFromJson(entry, source, commands, seen);
    return;
  }
  if (!isJsonObject(value)) return;
  const command = parseString(value.command) ?? parseString(value.cmd);
  if (command !== undefined) addCommand(commands, seen, source, "process", command);
  const argv = parseStringArray(value.argv);
  if (argv.length > 0) addCommand(commands, seen, source, "process", argv.join(" "));
  const args = parseStringArray(value.args);
  if (args.length > 0) addCommand(commands, seen, source, "process", args.join(" "));
  for (const entry of Object.values(value)) {
    collectCommandsFromJson(entry, source, commands, seen);
  }
}
