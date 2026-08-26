import { writeStderr, writeStdoutLine } from "./modules/rendering/transport.js";
import {
  assertTaskQueueValid,
  formatTaskQueueValidationSummary,
} from "./modules/repo-tasks/task-queue-validation.js";

function usage(): string {
  return [
    "Usage: validate-queue [--summary]",
    "",
    "Options:",
    "  --summary  Print a concise success summary for run artifacts.",
    "  --help     Show this help text.",
  ].join("\n");
}

try {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    writeStdoutLine(usage());
    process.exit(0);
  }
  const unknown = args.find((arg) => arg !== "--summary");
  if (unknown) throw new Error(`Unknown argument: ${unknown}\n\n${usage()}`);

  const result = assertTaskQueueValid(process.cwd());
  if (args.includes("--summary")) {
    writeStdoutLine(formatTaskQueueValidationSummary(result));
  }
} catch (error) {
  writeStderr(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
