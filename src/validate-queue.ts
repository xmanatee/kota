import {
  assertTaskQueueValid,
  formatTaskQueueValidationSummary,
  type TaskQueueValidationOptions,
} from "./modules/repo-tasks/task-queue-validation.js";

type ValidateQueueCliArgs = {
  minReady: number | undefined;
  summary: boolean;
  help: boolean;
};

function usage(): string {
  return [
    "Usage: validate-queue [--min-ready <count>] [--summary]",
    "",
    "Options:",
    "  --min-ready <count>  Require at least this many ready tasks.",
    "  --summary            Print a concise success summary for run artifacts.",
    "  --help               Show this help text.",
  ].join("\n");
}

function parseCount(value: string | undefined, flag: string): number {
  if (value === undefined) {
    throw new Error(`${flag} requires a numeric value.\n\n${usage()}`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new Error(`${flag} must be a non-negative integer.\n\n${usage()}`);
  }
  return parsed;
}

function parseArgs(args: string[]): ValidateQueueCliArgs {
  const parsed: ValidateQueueCliArgs = {
    minReady: undefined,
    summary: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--summary") {
      parsed.summary = true;
      continue;
    }
    if (arg === "--min-ready") {
      parsed.minReady = parseCount(args[index + 1], "--min-ready");
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }

  return parsed;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const options: TaskQueueValidationOptions =
    args.minReady !== undefined ? { minReady: args.minReady } : {};
  const result = assertTaskQueueValid(process.cwd(), options);
  if (args.summary) {
    console.log(formatTaskQueueValidationSummary(result));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
