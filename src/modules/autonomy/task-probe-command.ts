export type ParsedProbeCommand = {
  executable: "pnpm";
  args: string[];
  maxTimeoutMs: number;
};

const PNPM_SCRIPT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_./-]*$/;
const FIXTURE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const PACKAGE_SCRIPT_MAX_TIMEOUT_MS = 30 * 60 * 1000;
const EVAL_FIXTURE_MAX_TIMEOUT_MS = 4 * 60 * 60 * 1000;

export function parseConstrainedProbeCommand(command: string): ParsedProbeCommand {
  const tokens = tokenizeProbeCommand(command);
  if (tokens.length === 0) {
    throw new Error("Runtime Probe command must not be empty.");
  }
  if (tokens[0] !== "pnpm") {
    throw new Error(
      `Runtime Probe command must start with "pnpm"; got "${tokens[0]}".`,
    );
  }

  const args = tokens.slice(1);
  return {
    executable: "pnpm",
    args,
    maxTimeoutMs: validatePnpmProbeArgs(args),
  };
}

function validatePnpmProbeArgs(args: string[]): number {
  const subcommand = args[0];
  if (!subcommand) {
    throw new Error("Runtime Probe pnpm command must include a subcommand.");
  }

  if (subcommand === "run") {
    const script = args[1];
    if (!script || !PNPM_SCRIPT_PATTERN.test(script)) {
      throw new Error("Runtime Probe pnpm run command must name one package script.");
    }
    return PACKAGE_SCRIPT_MAX_TIMEOUT_MS;
  }

  if (subcommand === "test") {
    return PACKAGE_SCRIPT_MAX_TIMEOUT_MS;
  }

  if (subcommand === "kota") {
    const expectedPrefix = ["eval", "run", "--fixture"];
    if (!expectedPrefix.every((token, index) => args[index + 1] === token)) {
      throw new Error(
        'Runtime Probe "pnpm kota" command must run exactly one eval fixture.',
      );
    }
    const fixtureId = args[4];
    if (!fixtureId || !FIXTURE_ID_PATTERN.test(fixtureId)) {
      throw new Error(
        "Runtime Probe eval command must name one lowercase fixture id.",
      );
    }
    const suffix = args.slice(5);
    if (
      suffix.length !== 3 ||
      suffix[0] !== "--repeats" ||
      suffix[1] !== "1" ||
      suffix[2] !== "--keep"
    ) {
      throw new Error(
        'Runtime Probe eval command must end with "--repeats 1 --keep".',
      );
    }
    return EVAL_FIXTURE_MAX_TIMEOUT_MS;
  }

  throw new Error(
    `Runtime Probe pnpm subcommand "${subcommand}" is not allowed; use "pnpm run <script>", "pnpm test", or one constrained "pnpm kota eval run".`,
  );
}

function tokenizeProbeCommand(command: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | "\"" | null = null;
  let tokenStarted = false;

  const pushToken = () => {
    if (!tokenStarted) return;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      throw new Error(
        `Runtime Probe command may not declare environment assignments (${token}).`,
      );
    }
    tokens.push(token);
    token = "";
    tokenStarted = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
        tokenStarted = true;
        continue;
      }
      if (quote === "\"" && char === "\\" && index + 1 < command.length) {
        token += command[index + 1];
        tokenStarted = true;
        index += 1;
        continue;
      }
      token += char;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      pushToken();
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      tokenStarted = true;
      continue;
    }
    if (char === "\\" && index + 1 < command.length) {
      token += command[index + 1];
      tokenStarted = true;
      index += 1;
      continue;
    }
    if (/[;&|<>()`$]/.test(char)) {
      throw new Error(
        `Runtime Probe command contains shell metacharacter "${char}", which is not allowed.`,
      );
    }
    token += char;
    tokenStarted = true;
  }

  if (quote) {
    throw new Error("Runtime Probe command has an unterminated quote.");
  }
  pushToken();
  return tokens;
}
