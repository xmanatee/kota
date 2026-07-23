import { JsonFileError } from "#core/util/json-file.js";

export type DaemonState = {
  startedAt: string;
  lastStoppedAt?: string;
  lastStopReason?: DaemonStopReason;
  pid: number;
};

export type DaemonStopReason = "sigint" | "sigterm" | "restart" | "programmatic";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function assertDaemonState(path: string, value: unknown): asserts value is DaemonState {
  if (!isPlainObject(value)) {
    throw new JsonFileError(path, "parse", "invalid daemon state shape");
  }
  const pid = value.pid;
  if (typeof value.startedAt !== "string" || !value.startedAt.trim()) {
    throw new JsonFileError(path, "parse", "daemon state missing startedAt");
  }
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    throw new JsonFileError(path, "parse", "daemon state missing pid");
  }
  if (
    value.lastStoppedAt !== undefined &&
    (typeof value.lastStoppedAt !== "string" || !value.lastStoppedAt.trim())
  ) {
    throw new JsonFileError(path, "parse", "daemon state has invalid lastStoppedAt");
  }
  if (
    value.lastStopReason !== undefined &&
    value.lastStopReason !== "sigint" &&
    value.lastStopReason !== "sigterm" &&
    value.lastStopReason !== "restart" &&
    value.lastStopReason !== "programmatic"
  ) {
    throw new JsonFileError(path, "parse", "daemon state has invalid lastStopReason");
  }
}
