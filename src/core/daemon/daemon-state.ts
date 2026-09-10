import { JsonFileError } from "#core/util/json-file.js";
import { canonicalRuntimeRevision, type DaemonRuntimeRevision, daemonRuntimeRevisionSchema } from "./daemon-runtime-revision.js";

export type DaemonState = {
  startedAt: string;
  lastStoppedAt?: string;
  lastStopReason?: DaemonStopReason;
  pid: number;
  /** Absent only in state persisted by an older daemon. */
  runtimeRevision?: DaemonRuntimeRevision;
};

export type DaemonStopReason = "sigint" | "sigterm" | "restart" | "programmatic";

export function snapshotDaemonState(state: DaemonState): DaemonState {
  return {
    ...state,
    ...(state.runtimeRevision === undefined ? {} : {
      runtimeRevision: {
        ...state.runtimeRevision,
        canonicalRevision: canonicalRuntimeRevision(state.runtimeRevision.root),
        activation: state.runtimeRevision.activation === null ? null : { ...state.runtimeRevision.activation },
      },
    }),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function assertDaemonState(path: string, value: unknown): asserts value is DaemonState {
  if (!isPlainObject(value)) {
    throw new JsonFileError(path, "parse", "invalid daemon state shape");
  }
  const pid = value.pid;
  if (value.runtimeRevision !== undefined && !daemonRuntimeRevisionSchema.safeParse(value.runtimeRevision).success) {
    throw new JsonFileError(path, "parse", "daemon state has invalid runtime revision");
  }
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
