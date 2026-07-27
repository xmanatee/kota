import { spawnSync } from "node:child_process";
import { RUNTIME_PROBE_ARTIFACT_WRITER_SOURCE } from "./critic-runtime-probe-artifact-writer-source.js";

const WRITER_MAX_BUFFER = 1024 * 1024;

export type FileIdentity = {
  dev: number;
  ino: number;
};

type ArtifactWriterRequest = {
  expectedArtifactIdentity: FileIdentity | null;
  runDirectoryIdentity: FileIdentity;
  runDirectoryPath: string;
  serializedArtifact: string;
};

type ArtifactWriterResponse =
  | { ok: true }
  | { ok: false; reason: string };

function decodeWriterResponse(stdout: string): ArtifactWriterResponse {
  try {
    const response = JSON.parse(stdout) as ArtifactWriterResponse;
    if (response.ok === true) return response;
    if (response.ok === false && typeof response.reason === "string") {
      return response;
    }
  } catch {
    // The caller reports one stable error for malformed helper output.
  }
  throw new Error("Runtime Probe artifact writer returned an invalid response");
}

export function writeAnchoredRuntimeProbeArtifact(
  request: ArtifactWriterRequest,
): void {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", RUNTIME_PROBE_ARTIFACT_WRITER_SOURCE],
    {
      cwd: request.runDirectoryPath,
      encoding: "utf8",
      env: {},
      input: JSON.stringify(request),
      maxBuffer: WRITER_MAX_BUFFER,
      windowsHide: true,
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new Error("Runtime Probe isolated artifact writer failed");
  }

  const response = decodeWriterResponse(result.stdout);
  if (!response.ok) throw new Error(response.reason);
}
