import { spawnSync } from "node:child_process";
import { DIRECTORY_HELPER_SOURCE } from "./project-config-directory-helper-source.js";

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
      projectRootPath: string;
      projectRootIdentity: FileIdentity;
    }
  | {
      operation: "read";
      projectRootPath: string;
      projectRootIdentity: FileIdentity;
      directoryIdentity: FileIdentity;
    }
  | {
      operation: "write";
      projectRootPath: string;
      projectRootIdentity: FileIdentity;
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

export function readAnchoredProjectConfig(
  projectRootPath: string,
  projectRootIdentity: FileIdentity,
  directoryIdentity: FileIdentity,
): ConfigFileSnapshot {
  const response = unwrapDirectoryHelper(
    runDirectoryHelper({
      operation: "read",
      projectRootPath,
      projectRootIdentity,
      directoryIdentity,
    }),
  );
  if (response.snapshot === undefined) {
    throw new Error("isolated filesystem helper omitted the config snapshot");
  }
  return response.snapshot;
}

export function ensureAnchoredProjectConfigDirectory(
  projectRootPath: string,
  projectRootIdentity: FileIdentity,
): FileIdentity {
  const response = unwrapDirectoryHelper(
    runDirectoryHelper({
      operation: "ensureDirectory",
      projectRootPath,
      projectRootIdentity,
    }),
  );
  if (response.directoryIdentity === undefined) {
    throw new Error(
      "isolated filesystem helper omitted the config directory identity",
    );
  }
  return response.directoryIdentity;
}

export function writeAnchoredProjectConfig(
  projectRootPath: string,
  projectRootIdentity: FileIdentity,
  directoryIdentity: FileIdentity,
  expectedConfigIdentity: FileIdentity | null,
  serializedConfig: string,
): void {
  unwrapDirectoryHelper(
    runDirectoryHelper({
      operation: "write",
      projectRootPath,
      projectRootIdentity,
      directoryIdentity,
      expectedConfigIdentity,
      serializedConfig,
    }),
  );
}
