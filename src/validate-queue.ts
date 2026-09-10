import { readGitTextTree } from "#core/util/repository-tree.js";
import { writeStderr, writeStdoutLine } from "./modules/rendering/transport.js";
import {
  assertTaskQueueValid,
  formatTaskQueueValidationSummary,
} from "./modules/repo-tasks/task-queue-validation.js";

function usage(): string {
  return [
    "Usage: validate-queue [--summary] [--staged]",
    "",
    "Options:",
    "  --summary  Print a concise success summary for run artifacts.",
    "  --staged   Validate the staged Git tree, including partially staged files.",
    "  --help     Show this help text.",
  ].join("\n");
}

try {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    writeStdoutLine(usage());
    process.exit(0);
  }
  const unknown = args.find((arg) => arg !== "--summary" && arg !== "--staged");
  if (unknown) throw new Error(`Unknown argument: ${unknown}\n\n${usage()}`);

  const tree = args.includes("--staged") ? readGitTextTree(process.cwd(), "index", ["data/tasks"]).tree : undefined;
  const result = assertTaskQueueValid(process.cwd(), tree);
  if (args.includes("--summary")) {
    writeStdoutLine(formatTaskQueueValidationSummary(result));
  }
} catch (error) {
  writeStderr(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
