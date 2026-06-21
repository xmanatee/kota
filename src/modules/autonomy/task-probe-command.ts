export type ParsedProbeCommand = {
  executable: "pnpm";
  args: string[];
};

const PNPM_SCRIPT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_./-]*$/;

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
  validatePnpmProbeArgs(args);
  return { executable: "pnpm", args };
}

function validatePnpmProbeArgs(args: string[]): void {
  const subcommand = args[0];
  if (!subcommand) {
    throw new Error("Runtime Probe pnpm command must include a subcommand.");
  }

  if (subcommand === "run") {
    const script = args[1];
    if (!script || !PNPM_SCRIPT_PATTERN.test(script)) {
      throw new Error("Runtime Probe pnpm run command must name one package script.");
    }
    return;
  }

  if (subcommand === "test") {
    return;
  }

  throw new Error(
    `Runtime Probe pnpm subcommand "${subcommand}" is not allowed; use "pnpm run <script>" or "pnpm test".`,
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
