import { spawnSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import {
  type FileIdentity,
  prepareSecretStorageDirectory,
  storageError,
} from "./secret-file-directory.js";
import { SECRET_FILE_STORAGE_HELPER_SOURCE } from "./secret-file-storage-helper-source.js";

const HELPER_MAX_BUFFER = 16 * 1024 * 1024;

type SecretFileSnapshot =
  | { exists: false }
  | { exists: true; contents: string; identity: FileIdentity };

type HelperRequest =
  | {
      operation: "read";
      directoryPath: string;
      directoryIdentity: FileIdentity;
      filename: string;
    }
  | {
      operation: "write";
      directoryPath: string;
      directoryIdentity: FileIdentity;
      filename: string;
      expectedFileIdentity: FileIdentity | null;
      contents: string;
    };

type HelperResponse =
  | {
      ok: true;
      snapshot?: SecretFileSnapshot;
      fileIdentity?: FileIdentity;
    }
  | { ok: false; reason: string };

type ExpectedFile =
  | { kind: "unread" }
  | { kind: "missing" }
  | { kind: "existing"; identity: FileIdentity };

function runHelper(request: HelperRequest): HelperResponse {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", SECRET_FILE_STORAGE_HELPER_SOURCE],
    {
      encoding: "utf8",
      env: {},
      input: JSON.stringify(request),
      maxBuffer: HELPER_MAX_BUFFER,
      windowsHide: true,
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new Error("isolated secret filesystem helper failed");
  }
  try {
    return JSON.parse(result.stdout) as HelperResponse;
  } catch {
    throw new Error("isolated secret filesystem helper returned invalid data");
  }
}

function unwrapHelper(response: HelperResponse, filePath: string): void {
  if (!response.ok) throw storageError(filePath, response.reason);
}

export class SecretFileStorage {
  private readonly directoryPath: string;
  private readonly filePath: string;
  private readonly filename: string;
  private expectedFile: ExpectedFile = { kind: "unread" };

  constructor(filePath: string) {
    this.filePath = resolve(filePath);
    this.directoryPath = dirname(this.filePath);
    this.filename = basename(this.filePath);
  }

  read(): string | undefined {
    const directoryIdentity = prepareSecretStorageDirectory(
      this.directoryPath,
      false,
    );
    if (directoryIdentity === undefined) {
      this.expectedFile = { kind: "missing" };
      return undefined;
    }
    const response = runHelper({
      operation: "read",
      directoryPath: this.directoryPath,
      directoryIdentity,
      filename: this.filename,
    });
    unwrapHelper(response, this.filePath);
    if (!response.ok || response.snapshot === undefined) {
      throw new Error("isolated secret filesystem helper omitted the snapshot");
    }
    if (!response.snapshot.exists) {
      this.expectedFile = { kind: "missing" };
      return undefined;
    }
    this.expectedFile = {
      kind: "existing",
      identity: response.snapshot.identity,
    };
    return response.snapshot.contents;
  }

  write(contents: string): void {
    if (this.expectedFile.kind === "unread") {
      throw storageError(this.filePath, "must be read before it is updated");
    }
    const directoryIdentity = prepareSecretStorageDirectory(
      this.directoryPath,
      true,
    );
    if (directoryIdentity === undefined) {
      throw storageError(this.directoryPath, "could not be created");
    }
    const response = runHelper({
      operation: "write",
      directoryPath: this.directoryPath,
      directoryIdentity,
      filename: this.filename,
      expectedFileIdentity:
        this.expectedFile.kind === "existing"
          ? this.expectedFile.identity
          : null,
      contents,
    });
    unwrapHelper(response, this.filePath);
    if (!response.ok || response.fileIdentity === undefined) {
      throw new Error(
        "isolated secret filesystem helper omitted the file identity",
      );
    }
    this.expectedFile = {
      kind: "existing",
      identity: response.fileIdentity,
    };
  }
}
