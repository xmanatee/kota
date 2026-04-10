import { assertTaskQueueValid } from "./modules/repo-tasks/task-queue-validation.js";

const args = process.argv.slice(2);
const minReadyIdx = args.indexOf("--min-ready");
const minReady = minReadyIdx >= 0 ? parseInt(args[minReadyIdx + 1], 10) : undefined;

assertTaskQueueValid(process.cwd(), minReady !== undefined ? { minReady } : {});
