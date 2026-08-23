import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync, type Stats } from "node:fs";
import { resolve } from "node:path";
import type { KotaJsonObject, KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { TASK_CLAIM_FILESYSTEM_HELPER_SOURCE } from "./task-claim-filesystem-helper-source.js";

const CLAIM_FILESYSTEM_HELPER_MAX_BUFFER = 16 * 1024 * 1024;

export type ClaimFileIdentity = {
  dev: number;
  ino: number;
};

type ClaimFilesystemOperation =
  | { operation: "read-active"; taskId: string; fileName: string }
  | { operation: "list-active" }
  | {
    operation: "write-active";
    taskId: string;
    fileName: string;
    content: string;
    flag: "w" | "wx";
  }
  | {
    operation: "archive-active" | "copy-active-history";
    taskId: string;
    fileName: string;
    historyTaskSegment: string;
    historyFileName: string;
  }
  | { operation: "acquire-lock"; lockFileName: string; content: string }
  | {
    operation: "release-lock";
    lockFileName: string;
    lockIdentity: ClaimFileIdentity;
  };

export type ClaimFilesystemResponse = {
  content?: string | null;
  entries?: Array<{ name: string; taskId: string; content: string }>;
  acquired?: boolean;
  available?: boolean;
  lockIdentity?: ClaimFileIdentity;
  writeConflict?: boolean;
};

function fail(reason: string): never {
  throw new Error(`Task claim filesystem: ${reason}`);
}

function identity(stats: Stats): ClaimFileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

function isJsonObject(value: KotaJsonValue | undefined): value is KotaJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileIdentity(value: KotaJsonValue | undefined): value is ClaimFileIdentity {
  return isJsonObject(value) &&
    Number.isSafeInteger(value.dev) &&
    Number.isSafeInteger(value.ino);
}

function decodeResponse(stdout: string): ClaimFilesystemResponse {
  let value: KotaJsonValue;
  try {
    value = JSON.parse(stdout) as KotaJsonValue;
  } catch (cause) {
    throw new Error("Task claim filesystem helper returned invalid JSON", { cause });
  }
  if (!isJsonObject(value)) fail("helper returned an invalid response");
  if (value.ok === false && typeof value.reason === "string") fail(value.reason);
  if (value.ok !== true) fail("helper returned an invalid response");

  const response: ClaimFilesystemResponse = {};
  if (value.content === null || typeof value.content === "string") {
    response.content = value.content;
  }
  if (Array.isArray(value.entries)) {
    response.entries = value.entries.map((entry) => {
      if (
        !isJsonObject(entry) ||
        typeof entry.name !== "string" ||
        typeof entry.taskId !== "string" ||
        typeof entry.content !== "string"
      ) {
        return fail("helper returned an invalid claim entry");
      }
      return { name: entry.name, taskId: entry.taskId, content: entry.content };
    });
  }
  if (typeof value.acquired === "boolean") response.acquired = value.acquired;
  if (typeof value.available === "boolean") response.available = value.available;
  if (typeof value.writeConflict === "boolean") {
    response.writeConflict = value.writeConflict;
  }
  if (isFileIdentity(value.lockIdentity)) response.lockIdentity = value.lockIdentity;
  return response;
}

export function runClaimFilesystemOperation(
  projectDir: string,
  operation: ClaimFilesystemOperation,
): ClaimFilesystemResponse {
  const projectPath = resolve(projectDir);
  const projectStats = lstatSync(projectPath);
  if (projectStats.isSymbolicLink() || !projectStats.isDirectory()) {
    fail("project root must be a real directory");
  }
  const request = {
    ...operation,
    projectIdentity: identity(projectStats),
    projectPath,
    projectRealPath: realpathSync.native(projectPath),
  };
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", TASK_CLAIM_FILESYSTEM_HELPER_SOURCE],
    {
      cwd: projectPath,
      encoding: "utf8",
      env: {},
      input: JSON.stringify(request),
      maxBuffer: CLAIM_FILESYSTEM_HELPER_MAX_BUFFER,
      windowsHide: true,
    },
  );
  if (result.error !== undefined || result.status !== 0) fail("isolated helper failed");
  return decodeResponse(result.stdout);
}
