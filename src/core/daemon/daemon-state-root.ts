import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync, type Stats } from "node:fs";
import { join, resolve } from "node:path";
import { DAEMON_STATE_ROOT_HELPER_SOURCE } from "./daemon-state-root-helper-source.js";

const HELPER_MAX_BUFFER = 16 * 1024 * 1024;

export type FileIdentity = {
  dev: number;
  ino: number;
};

export type DaemonOwnershipFilename =
  | "daemon-instance.lock"
  | "daemon-control.json";

export type DaemonStateRoot =
  | {
      kind: "scope-owned";
      path: string;
      scopeRootPath: string;
      scopeRootIdentity: FileIdentity;
      directoryIdentity: FileIdentity;
    }
  | {
      kind: "operator-configured";
      path: string;
    };

export type AnchoredFileSnapshot =
  | { exists: false }
  | { exists: true; contents: string; identity: FileIdentity };

type HelperRequest =
  | {
      operation: "ensure";
      scopeRootPath: string;
      scopeRootIdentity: FileIdentity;
    }
  | {
      operation: "read";
      scopeRootPath: string;
      scopeRootIdentity: FileIdentity;
      directoryIdentity: FileIdentity;
      filename: DaemonOwnershipFilename;
    }
  | {
      operation: "create";
      scopeRootPath: string;
      scopeRootIdentity: FileIdentity;
      directoryIdentity: FileIdentity;
      filename: DaemonOwnershipFilename;
      contents: string;
    }
  | {
      operation: "remove";
      scopeRootPath: string;
      scopeRootIdentity: FileIdentity;
      directoryIdentity: FileIdentity;
      filename: DaemonOwnershipFilename;
      expectedIdentity: FileIdentity;
    };

type HelperResponse =
  | {
      ok: true;
      directoryIdentity?: FileIdentity;
      snapshot?: AnchoredFileSnapshot;
      created?: boolean;
      removed?: boolean;
    }
  | { ok: false; reason: string };

function identity(stats: Stats): FileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

function runHelper(request: HelperRequest): HelperResponse {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", DAEMON_STATE_ROOT_HELPER_SOURCE],
    {
      encoding: "utf8",
      env: {},
      input: JSON.stringify(request),
      maxBuffer: HELPER_MAX_BUFFER,
      windowsHide: true,
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new Error("isolated daemon state filesystem helper failed");
  }
  try {
    return JSON.parse(result.stdout) as HelperResponse;
  } catch {
    throw new Error("isolated daemon state filesystem helper returned invalid data");
  }
}

function unwrap(response: HelperResponse, path: string): Extract<HelperResponse, { ok: true }> {
  if (!response.ok) throw new Error(`${path}: ${response.reason}`);
  return response;
}

function anchoredRequest(
  root: Extract<DaemonStateRoot, { kind: "scope-owned" }>,
): Pick<
  Extract<HelperRequest, { operation: "read" }>,
  "scopeRootPath" | "scopeRootIdentity" | "directoryIdentity"
> {
  return {
    scopeRootPath: root.scopeRootPath,
    scopeRootIdentity: root.scopeRootIdentity,
    directoryIdentity: root.directoryIdentity,
  };
}

export function prepareDaemonStateRoot(
  scopeRoot: string,
  configuredStateDir: string | undefined,
): DaemonStateRoot {
  if (configuredStateDir !== undefined) {
    return { kind: "operator-configured", path: configuredStateDir };
  }

  const scopeRootPath = realpathSync.native(resolve(scopeRoot));
  const scopeStats = lstatSync(scopeRootPath);
  if (!scopeStats.isDirectory()) {
    throw new Error(`${scopeRootPath}: daemon scope root must be a directory`);
  }
  const scopeRootIdentity = identity(scopeStats);
  const path = join(scopeRootPath, ".kota");
  const response = unwrap(
    runHelper({ operation: "ensure", scopeRootPath, scopeRootIdentity }),
    path,
  );
  if (response.directoryIdentity === undefined) {
    throw new Error("isolated daemon state filesystem helper omitted the directory identity");
  }
  return {
    kind: "scope-owned",
    path,
    scopeRootPath,
    scopeRootIdentity,
    directoryIdentity: response.directoryIdentity,
  };
}

export function readAnchoredDaemonOwnershipFile(
  root: Extract<DaemonStateRoot, { kind: "scope-owned" }>,
  filename: DaemonOwnershipFilename,
): AnchoredFileSnapshot {
  const response = unwrap(
    runHelper({ operation: "read", ...anchoredRequest(root), filename }),
    join(root.path, filename),
  );
  if (response.snapshot === undefined) {
    throw new Error("isolated daemon state filesystem helper omitted the file snapshot");
  }
  return response.snapshot;
}

export function createAnchoredDaemonOwnershipFile(
  root: Extract<DaemonStateRoot, { kind: "scope-owned" }>,
  filename: DaemonOwnershipFilename,
  contents: string,
): boolean {
  const response = unwrap(
    runHelper({ operation: "create", ...anchoredRequest(root), filename, contents }),
    join(root.path, filename),
  );
  if (response.created === undefined) {
    throw new Error("isolated daemon state filesystem helper omitted the create result");
  }
  return response.created;
}

export function removeAnchoredDaemonOwnershipFile(
  root: Extract<DaemonStateRoot, { kind: "scope-owned" }>,
  filename: DaemonOwnershipFilename,
  expectedIdentity: FileIdentity,
): boolean {
  const response = unwrap(
    runHelper({
      operation: "remove",
      ...anchoredRequest(root),
      filename,
      expectedIdentity,
    }),
    join(root.path, filename),
  );
  if (response.removed === undefined) {
    throw new Error("isolated daemon state filesystem helper omitted the remove result");
  }
  return response.removed;
}
