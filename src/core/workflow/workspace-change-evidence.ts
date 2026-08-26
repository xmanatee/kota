import { spawnSync } from "node:child_process";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

const ERROR_DETAIL_MAX_BYTES = 4 * 1024;
const MIN_GIT_BUFFER_BYTES = 64 * 1024;

export const DEFAULT_WORKSPACE_CHANGE_EVIDENCE_LIMITS = {
  changedPathsBytes: 5 * 1024 * 1024,
  diffBytes: 50 * 1024 * 1024,
  statBytes: 5 * 1024 * 1024,
} as const;

export type WorkspaceChangeStatus =
  | "added"
  | "deleted"
  | "modified"
  | "type-changed"
  | "unmerged";

export type WorkspaceChange = {
  path: string;
  status: WorkspaceChangeStatus;
  tracked: boolean;
};

export type BoundedWorkspaceChangeOutput = {
  text: string;
  truncated: boolean;
  limitBytes: number;
};

export type WorkspaceChangeEvidence = {
  changes: readonly WorkspaceChange[];
  diff: BoundedWorkspaceChangeOutput;
  stat: BoundedWorkspaceChangeOutput;
};

export type WorkspaceChangeEvidenceLimits = {
  changedPathsBytes: number;
  diffBytes: number;
  statBytes: number;
};

export type WorkspaceChangeEvidenceOptions = {
  pathspecs?: readonly string[];
  unifiedLines?: number;
  limits?: Partial<WorkspaceChangeEvidenceLimits>;
};

type ResolvedWorkspaceChangeEvidenceOptions = {
  pathspecs: readonly string[];
  unifiedLines: number;
  limits: WorkspaceChangeEvidenceLimits;
};

type GitOutput = {
  stdout: Buffer;
  truncated: boolean;
};

export class WorkspaceChangeCommandError extends Error {
  readonly workspaceRoot: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;

  constructor(args: {
    workspaceRoot: string;
    gitArgs: readonly string[];
    exitCode: number | null;
    detail: string;
  }) {
    super(
      `Git workspace evidence command failed in ${args.workspaceRoot} ` +
        `(${JSON.stringify(["git", ...args.gitArgs])}): ${args.detail}`,
    );
    this.name = "WorkspaceChangeCommandError";
    this.workspaceRoot = args.workspaceRoot;
    this.args = [...args.gitArgs];
    this.exitCode = args.exitCode;
  }
}

export class WorkspaceChangeOutputLimitError extends Error {
  readonly output: "changed-paths" | "diff" | "stat";
  readonly limitBytes: number;

  constructor(output: "changed-paths" | "diff" | "stat", limitBytes: number) {
    super(
      `Git workspace ${output} output exceeded the ${limitBytes}-byte limit`,
    );
    this.name = "WorkspaceChangeOutputLimitError";
    this.output = output;
    this.limitBytes = limitBytes;
  }
}

function validatePositiveByteLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function resolveOptions(
  options: WorkspaceChangeEvidenceOptions = {},
): ResolvedWorkspaceChangeEvidenceOptions {
  const unifiedLines = options.unifiedLines ?? 3;
  if (!Number.isSafeInteger(unifiedLines) || unifiedLines < 0) {
    throw new RangeError("unifiedLines must be a non-negative safe integer");
  }
  return {
    pathspecs: options.pathspecs ?? ["."],
    unifiedLines,
    limits: {
      changedPathsBytes: validatePositiveByteLimit(
        "limits.changedPathsBytes",
        options.limits?.changedPathsBytes ??
          DEFAULT_WORKSPACE_CHANGE_EVIDENCE_LIMITS.changedPathsBytes,
      ),
      diffBytes: validatePositiveByteLimit(
        "limits.diffBytes",
        options.limits?.diffBytes ??
          DEFAULT_WORKSPACE_CHANGE_EVIDENCE_LIMITS.diffBytes,
      ),
      statBytes: validatePositiveByteLimit(
        "limits.statBytes",
        options.limits?.statBytes ??
          DEFAULT_WORKSPACE_CHANGE_EVIDENCE_LIMITS.statBytes,
      ),
    },
  };
}

function isOutputBufferError(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOBUFS";
}

function boundedUtf8(buffer: Buffer, limitBytes: number): string {
  if (buffer.length <= limitBytes) return buffer.toString("utf8");
  let end = limitBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString("utf8");
}

function commandFailureDetail(stderr: Buffer, fallback: string): string {
  const detail = boundedUtf8(stderr, ERROR_DETAIL_MAX_BYTES).trim();
  return detail.length > 0 ? detail : fallback;
}

function runGit(
  workspaceRoot: string,
  args: readonly string[],
  acceptedExitCodes: readonly number[],
  maxOutputBytes: number,
): GitOutput {
  const result = spawnSync("git", [...args], {
    cwd: workspaceRoot,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "buffer",
    maxBuffer: Math.max(maxOutputBytes + 1, MIN_GIT_BUFFER_BYTES),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const outputBufferError =
    result.error !== undefined && isOutputBufferError(result.error);
  if (result.error !== undefined && !outputBufferError) {
    throw new WorkspaceChangeCommandError({
      workspaceRoot,
      gitArgs: args,
      exitCode: result.status,
      detail: result.error.message,
    });
  }
  if (!outputBufferError && !acceptedExitCodes.includes(result.status ?? -1)) {
    throw new WorkspaceChangeCommandError({
      workspaceRoot,
      gitArgs: args,
      exitCode: result.status,
      detail: commandFailureDetail(
        result.stderr,
        result.signal === null
          ? `git exited ${result.status ?? "without a status"}`
          : `git terminated with ${result.signal}`,
      ),
    });
  }
  return {
    stdout: result.stdout.subarray(0, maxOutputBytes),
    truncated: outputBufferError || result.stdout.length > maxOutputBytes,
  };
}

function runGitComplete(
  workspaceRoot: string,
  args: readonly string[],
  maxOutputBytes: number,
): Buffer {
  const output = runGit(workspaceRoot, args, [0], maxOutputBytes);
  if (output.truncated) {
    throw new WorkspaceChangeOutputLimitError("changed-paths", maxOutputBytes);
  }
  return output.stdout;
}

function nulRecords(output: Buffer): string[] {
  if (output.length === 0) return [];
  if (output.at(-1) !== 0) {
    throw new Error("Git workspace evidence returned an incomplete NUL record");
  }
  return output.subarray(0, -1).toString("utf8").split("\0");
}

function trackedStatus(status: string): WorkspaceChangeStatus {
  switch (status.at(0)) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "M":
      return "modified";
    case "T":
      return "type-changed";
    case "U":
      return "unmerged";
    default:
      throw new Error(`Unsupported Git workspace change status: ${status}`);
  }
}

function parseTrackedChanges(output: Buffer): WorkspaceChange[] {
  const records = nulRecords(output);
  if (records.length % 2 !== 0) {
    throw new Error("Git workspace evidence returned an incomplete status/path pair");
  }
  const changes: WorkspaceChange[] = [];
  for (let index = 0; index < records.length; index += 2) {
    changes.push({
      path: records[index + 1],
      status: trackedStatus(records[index]),
      tracked: true,
    });
  }
  return changes;
}

function compareChanges(a: WorkspaceChange, b: WorkspaceChange): number {
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return Number(b.tracked) - Number(a.tracked);
}

function readWorkspaceChangesWithOptions(
  workspaceRoot: string,
  options: ResolvedWorkspaceChangeEvidenceOptions,
): WorkspaceChange[] {
  const tracked = parseTrackedChanges(
    runGitComplete(
      workspaceRoot,
      [
        "diff",
        "--name-status",
        "--no-renames",
        "-z",
        "HEAD",
        "--",
        ...options.pathspecs,
      ],
      options.limits.changedPathsBytes,
    ),
  );
  const trackedPaths = new Set(tracked.map((change) => change.path));
  const untracked = nulRecords(
    runGitComplete(
      workspaceRoot,
      [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ...options.pathspecs,
      ],
      options.limits.changedPathsBytes,
    ),
  )
    .filter((path) => !trackedPaths.has(path))
    .map((path): WorkspaceChange => ({
      path,
      status: "added",
      tracked: false,
    }));
  return [...tracked, ...untracked].sort(compareChanges);
}

function collectBoundedOutput(args: {
  workspaceRoot: string;
  limitBytes: number;
  commands: readonly {
    args: readonly string[];
    acceptedExitCodes: readonly number[];
  }[];
}): BoundedWorkspaceChangeOutput {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let truncated = false;
  for (const command of args.commands) {
    const separatorBytes = byteLength > 0 ? 1 : 0;
    const remainingBytes = args.limitBytes - byteLength - separatorBytes;
    if (remainingBytes <= 0) {
      truncated = true;
      break;
    }
    const output = runGit(
      args.workspaceRoot,
      command.args,
      command.acceptedExitCodes,
      remainingBytes,
    );
    if (output.stdout.length > 0) {
      if (separatorBytes > 0) {
        chunks.push(Buffer.from("\n"));
        byteLength += 1;
      }
      chunks.push(output.stdout);
      byteLength += output.stdout.length;
    }
    if (output.truncated) {
      truncated = true;
      break;
    }
  }
  return {
    text: boundedUtf8(Buffer.concat(chunks, byteLength), args.limitBytes),
    truncated,
    limitBytes: args.limitBytes,
  };
}

function untrackedPaths(changes: readonly WorkspaceChange[]): string[] {
  return changes
    .filter((change) => !change.tracked)
    .map((change) => change.path);
}

function readUnifiedDiffWithOptions(
  workspaceRoot: string,
  changes: readonly WorkspaceChange[],
  options: ResolvedWorkspaceChangeEvidenceOptions,
): BoundedWorkspaceChangeOutput {
  const commands = [
    {
      args: [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        `--unified=${options.unifiedLines}`,
        "HEAD",
        "--",
        ...options.pathspecs,
      ],
      acceptedExitCodes: [0],
    },
    ...untrackedPaths(changes).map((path) => ({
      args: [
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        `--unified=${options.unifiedLines}`,
        "--",
        "/dev/null",
        path,
      ],
      acceptedExitCodes: [0, 1],
    })),
  ];
  return collectBoundedOutput({
    workspaceRoot,
    limitBytes: options.limits.diffBytes,
    commands,
  });
}

function readDiffStatWithOptions(
  workspaceRoot: string,
  changes: readonly WorkspaceChange[],
  options: ResolvedWorkspaceChangeEvidenceOptions,
): BoundedWorkspaceChangeOutput {
  const commands = [
    {
      args: [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--stat",
        "HEAD",
        "--",
        ...options.pathspecs,
      ],
      acceptedExitCodes: [0],
    },
    ...untrackedPaths(changes).map((path) => ({
      args: [
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--stat",
        "--",
        "/dev/null",
        path,
      ],
      acceptedExitCodes: [0, 1],
    })),
  ];
  return collectBoundedOutput({
    workspaceRoot,
    limitBytes: options.limits.statBytes,
    commands,
  });
}

export function readWorkspaceChanges(
  workspaceRoot: string,
  pathspecs: readonly string[] = ["."],
): readonly WorkspaceChange[] {
  return readWorkspaceChangesWithOptions(workspaceRoot, resolveOptions({ pathspecs }));
}

export function readWorkspaceUnifiedDiff(
  workspaceRoot: string,
  options: WorkspaceChangeEvidenceOptions = {},
): BoundedWorkspaceChangeOutput {
  const resolved = resolveOptions(options);
  const changes = readWorkspaceChangesWithOptions(workspaceRoot, resolved);
  return readUnifiedDiffWithOptions(workspaceRoot, changes, resolved);
}

export function readWorkspaceDiffStat(
  workspaceRoot: string,
  options: WorkspaceChangeEvidenceOptions = {},
): BoundedWorkspaceChangeOutput {
  const resolved = resolveOptions(options);
  const changes = readWorkspaceChangesWithOptions(workspaceRoot, resolved);
  return readDiffStatWithOptions(workspaceRoot, changes, resolved);
}

export function readWorkspaceChangeEvidence(
  workspaceRoot: string,
  options: WorkspaceChangeEvidenceOptions = {},
): WorkspaceChangeEvidence {
  const resolved = resolveOptions(options);
  const changes = readWorkspaceChangesWithOptions(workspaceRoot, resolved);
  return {
    changes,
    diff: readUnifiedDiffWithOptions(workspaceRoot, changes, resolved),
    stat: readDiffStatWithOptions(workspaceRoot, changes, resolved),
  };
}
