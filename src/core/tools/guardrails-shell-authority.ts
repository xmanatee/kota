import { isPathOutsideRoot, resolvePathFrom } from "./path-containment.js";

export type EnvironmentOverrideClass =
  | "credential/token"
  | "provider/profile"
  | "endpoint"
  | "KOTA control"
  | "telemetry routing"
  | "preset/harness"
  | "permission/sandbox"
  | "project/root"
  | "unclassified";

export type AuthorityChangingEnvironmentOverride = {
  name: string;
  overrideClass: EnvironmentOverrideClass;
};

const BENIGN_ENVIRONMENT_OVERRIDE_NAMES = new Set([
  "CI",
  "FORCE_COLOR",
  "KOTA_RENDERER_THEME",
  "NO_COLOR",
]);

const SHELL_ENV_ASSIGNMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=/;
const CREDENTIAL_ENV_PATTERN =
  /(^|_)(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS?|AUTH|COOKIE|SESSION|BEARER|OAUTH|PAT)(_|$)/;
const PROVIDER_PROFILE_ENV_PATTERN =
  /(^|_)(PROFILE|AWS|AZURE|GOOGLE|GCP|GCLOUD|CLOUDSDK|OPENAI|ANTHROPIC|GITHUB|GH|GITLAB|NPM|PNPM|YARN|HF|HUGGINGFACE)(_|$)/;
const ENDPOINT_ENV_PATTERN =
  /(^|_)(ENDPOINT|BASE_URL|API_URL|URL|URI|HOST|PROXY|REGISTRY)(_|$)/;
const TELEMETRY_ENV_PATTERN =
  /(^|_)(OTEL|OPENTELEMETRY|TELEMETRY|TRACING|TRACE|OTLP|EXPORTER)(_|$)/;
const PRESET_HARNESS_ENV_PATTERN = /(^|_)(PRESET|HARNESS|MODEL)(_|$)/;
const PERMISSION_SANDBOX_ENV_PATTERN =
  /(^|_)(PERMISSION|SANDBOX|APPROVAL|BYPASS|ALLOWLIST|DENYLIST|UNSAFE)(_|$)/;
const PROJECT_ROOT_ENV_PATTERN =
  /(^|_)(PROJECT_DIR|PROJECT_ROOT|WORKSPACE|WORKDIR|REPO_ROOT|ROOT|HOME|PWD)(_|$)/;
const DIRECTORY_CHANGING_COMMANDS = new Set(["cd", "pushd"]);

function skipShellWhitespace(command: string, index: number): number {
  let next = index;
  while (next < command.length && /\s/.test(command[next])) next += 1;
  return next;
}

function readShellWordEnd(command: string, index: number): number {
  let next = index;
  let quote: "'" | "\"" | null = null;

  while (next < command.length) {
    const char = command[next];
    if (quote) {
      if (char === quote) {
        quote = null;
        next += 1;
        continue;
      }
      if (quote === "\"" && char === "\\" && next + 1 < command.length) {
        next += 2;
        continue;
      }
      next += 1;
      continue;
    }

    if (/\s/.test(char)) break;
    if (char === "'" || char === "\"") {
      quote = char;
      next += 1;
      continue;
    }
    if (char === "\\" && next + 1 < command.length) {
      next += 2;
      continue;
    }
    next += 1;
  }

  return next;
}

type ShellWord = {
  value: string;
  end: number;
};

function readShellWord(command: string, index: number): ShellWord | null {
  let next = skipShellWhitespace(command, index);
  if (next >= command.length || /[&;|<>()]/.test(command[next])) return null;

  let value = "";
  let quote: "'" | "\"" | null = null;

  while (next < command.length) {
    const char = command[next];
    if (quote) {
      if (char === quote) {
        quote = null;
        next += 1;
        continue;
      }
      if (quote === "\"" && char === "\\" && next + 1 < command.length) {
        value += command[next + 1];
        next += 2;
        continue;
      }
      value += char;
      next += 1;
      continue;
    }

    if (/\s/.test(char) || /[&;|<>()]/.test(char)) break;
    if (char === "'" || char === "\"") {
      quote = char;
      next += 1;
      continue;
    }
    if (char === "\\" && next + 1 < command.length) {
      value += command[next + 1];
      next += 2;
      continue;
    }
    value += char;
    next += 1;
  }

  if (quote) return null;
  return { value, end: next };
}

function skipLeadingEnvironmentAssignments(command: string): number {
  let index = skipShellWhitespace(command, 0);

  while (index < command.length) {
    const match = SHELL_ENV_ASSIGNMENT_PATTERN.exec(command.slice(index));
    if (!match) break;
    index = skipShellWhitespace(
      command,
      readShellWordEnd(command, index + match[0].length),
    );
  }

  return index;
}

export function extractLeadingEnvironmentOverrideNames(command: string): string[] {
  const names: string[] = [];
  let index = skipShellWhitespace(command, 0);

  while (index < command.length) {
    const match = SHELL_ENV_ASSIGNMENT_PATTERN.exec(command.slice(index));
    if (!match) break;
    names.push(match[1]);
    index = skipShellWhitespace(
      command,
      readShellWordEnd(command, index + match[0].length),
    );
  }

  return names;
}

export function classifyEnvironmentOverride(
  name: string,
): EnvironmentOverrideClass | null {
  const normalized = name.toUpperCase();
  if (BENIGN_ENVIRONMENT_OVERRIDE_NAMES.has(normalized)) return null;
  if (CREDENTIAL_ENV_PATTERN.test(normalized)) return "credential/token";
  if (normalized.startsWith("KOTA_")) return "KOTA control";
  if (TELEMETRY_ENV_PATTERN.test(normalized)) return "telemetry routing";
  if (ENDPOINT_ENV_PATTERN.test(normalized)) return "endpoint";
  if (PROVIDER_PROFILE_ENV_PATTERN.test(normalized)) return "provider/profile";
  if (PRESET_HARNESS_ENV_PATTERN.test(normalized)) return "preset/harness";
  if (PERMISSION_SANDBOX_ENV_PATTERN.test(normalized)) return "permission/sandbox";
  if (PROJECT_ROOT_ENV_PATTERN.test(normalized)) return "project/root";
  return "unclassified";
}

export function findAuthorityChangingEnvironmentOverrides(
  command: string,
): AuthorityChangingEnvironmentOverride[] {
  const overrides: AuthorityChangingEnvironmentOverride[] = [];
  for (const name of extractLeadingEnvironmentOverrideNames(command)) {
    const overrideClass = classifyEnvironmentOverride(name);
    if (overrideClass) overrides.push({ name, overrideClass });
  }
  return overrides;
}

export function formatEnvironmentOverrideReasons(
  overrides: AuthorityChangingEnvironmentOverride[],
): string[] {
  return overrides.map(
    ({ name, overrideClass }) =>
      `${overrideClass} environment override detected (${name})`,
  );
}

function hasDirectoryChangeContinuation(command: string, index: number): boolean {
  const next = skipShellWhitespace(command, index);
  return command.startsWith("&&", next) || command.startsWith(";", next);
}

function isDeterministicDirectoryOperand(directory: string): boolean {
  return (
    directory.length > 0 &&
    directory !== "-" &&
    !directory.startsWith("~") &&
    !/[$`*?[]/.test(directory)
  );
}

function isCdOptionWord(word: string): boolean {
  return /^-[LP]+$/.test(word);
}

function readDirectoryOperand(
  command: string,
  index: number,
  commandName: string,
): ShellWord | null {
  let directoryWord = readShellWord(command, index);
  if (!directoryWord) return null;

  if (commandName === "cd") {
    while (isCdOptionWord(directoryWord.value)) {
      directoryWord = readShellWord(command, directoryWord.end);
      if (!directoryWord) return null;
    }
  }

  if (directoryWord.value === "--") {
    directoryWord = readShellWord(command, directoryWord.end);
    if (!directoryWord) return null;
  }

  return directoryWord;
}

function extractLeadingDirectoryChange(command: string): string | null {
  let index = skipLeadingEnvironmentAssignments(command);
  const commandWord = readShellWord(command, index);
  if (!commandWord || !DIRECTORY_CHANGING_COMMANDS.has(commandWord.value)) {
    return null;
  }

  index = commandWord.end;
  const directoryWord = readDirectoryOperand(command, index, commandWord.value);
  if (!directoryWord) return null;
  if (!hasDirectoryChangeContinuation(command, directoryWord.end)) return null;
  if (!isDeterministicDirectoryOperand(directoryWord.value)) return null;
  return directoryWord.value;
}

export function formatWorkingDirectoryReasons(
  command: string,
  cwdInput: string | undefined,
): string[] {
  const reasons: string[] = [];
  const commandStartDirectory = cwdInput
    ? resolvePathFrom(process.cwd(), cwdInput)
    : process.cwd();

  if (cwdInput && isPathOutsideRoot(cwdInput)) {
    reasons.push("project/root working directory override detected");
  }

  const changedDirectory = extractLeadingDirectoryChange(command);
  if (changedDirectory && isPathOutsideRoot(changedDirectory, commandStartDirectory)) {
    reasons.push("project/root directory-changing command detected");
  }

  return reasons;
}
