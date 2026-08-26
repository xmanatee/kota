import { spawnSync } from "node:child_process";
import { DIRECTORY_HELPER_SOURCE } from "./scope-config-directory-helper-source.js";

const DIRECTORY_HELPER_MAX_BUFFER = 64 * 1024 * 1024;

export interface FileIdentity {
  dev: number;
  ino: number;
}

export type ConfigFileSnapshot =
  | {
      exists: false;
    }
  | {
      exists: true;
      contents: string;
      identity: FileIdentity;
    };

type DirectoryHelperRequest =
  | {
      operation: "ensureDirectory";
      scopeRootPath: string;
      scopeRootIdentity: FileIdentity;
    }
  | {
      operation: "read";
      scopeRootPath: string;
      scopeRootIdentity: FileIdentity;
      directoryIdentity: FileIdentity;
    }
  | {
      operation: "write";
      scopeRootPath: string;
      scopeRootIdentity: FileIdentity;
      directoryIdentity: FileIdentity;
      expectedConfigIdentity: FileIdentity | null;
      serializedConfig: string;
    };

type DirectoryHelperResponse =
  | {
      ok: true;
      snapshot?: ConfigFileSnapshot;
      directoryIdentity?: FileIdentity;
    }
  | {
      ok: false;
      reason: string;
    };

function runDirectoryHelper(
  request: DirectoryHelperRequest,
): DirectoryHelperResponse {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", DIRECTORY_HELPER_SOURCE],
    {
      encoding: "utf8",
      env: {},
      input: JSON.stringify(request),
      maxBuffer: DIRECTORY_HELPER_MAX_BUFFER,
      windowsHide: true,
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new Error("isolated filesystem helper failed");
  }

  try {
    return JSON.parse(result.stdout) as DirectoryHelperResponse;
  } catch {
    throw new Error("isolated filesystem helper returned an invalid response");
  }
}

function unwrapDirectoryHelper(
  response: DirectoryHelperResponse,
): Extract<DirectoryHelperResponse, { ok: true }> {
  if (!response.ok) throw new Error(response.reason);
  return response;
}

export function readAnchoredScopeConfig(
  scopeRootPath: string,
  scopeRootIdentity: FileIdentity,
  directoryIdentity: FileIdentity,
): ConfigFileSnapshot {
  const response = unwrapDirectoryHelper(
    runDirectoryHelper({
      operation: "read",
      scopeRootPath,
      scopeRootIdentity,
      directoryIdentity,
    }),
  );
  if (response.snapshot === undefined) {
    throw new Error("isolated filesystem helper omitted the config snapshot");
  }
  return response.snapshot;
}

export function ensureAnchoredScopeConfigDirectory(
  scopeRootPath: string,
  scopeRootIdentity: FileIdentity,
): FileIdentity {
  const response = unwrapDirectoryHelper(
    runDirectoryHelper({
      operation: "ensureDirectory",
      scopeRootPath,
      scopeRootIdentity,
    }),
  );
  if (response.directoryIdentity === undefined) {
    throw new Error(
      "isolated filesystem helper omitted the config directory identity",
    );
  }
  return response.directoryIdentity;
}

export function writeAnchoredScopeConfig(
  scopeRootPath: string,
  scopeRootIdentity: FileIdentity,
  directoryIdentity: FileIdentity,
  expectedConfigIdentity: FileIdentity | null,
  serializedConfig: string,
): void {
  unwrapDirectoryHelper(
    runDirectoryHelper({
      operation: "write",
      scopeRootPath,
      scopeRootIdentity,
      directoryIdentity,
      expectedConfigIdentity,
      serializedConfig,
    }),
  );
}
