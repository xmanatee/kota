import { writeStderr } from "#modules/rendering/transport.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import { readWatchlist } from "./watchlist.js";

try {
  readWatchlist(process.cwd());
  assertTaskQueueValid(process.cwd());
} catch (error) {
  writeStderr(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
