import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
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

type ArtifactWriterJsonValue =
  | string
  | number
  | boolean
  | null
  | ArtifactWriterJsonValue[]
  | { [key: string]: ArtifactWriterJsonValue | undefined };

function isJsonObject(
  value: ArtifactWriterJsonValue,
): value is { [key: string]: ArtifactWriterJsonValue | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeWriterResponse(stdout: string): ArtifactWriterResponse {
  let response: ArtifactWriterJsonValue;
  try {
    response = JSON.parse(stdout);
  } catch (cause) {
    throw new Error("Runtime Probe artifact writer returned an invalid response", {
      cause,
    });
  }
  if (isJsonObject(response)) {
    if (response.ok === true) return { ok: true };
    if (
      response.ok === false &&
      typeof response.reason === "string"
    ) {
      return { ok: false, reason: response.reason };
    }
  }
  throw new Error("Runtime Probe artifact writer returned an invalid response");
}

export async function writeAnchoredRuntimeProbeArtifact(
  request: ArtifactWriterRequest,
  runCommand: WorkflowCommandRunner,
): Promise<void> {
  const result = await runCommand({
    command: process.execPath,
    args: ["--input-type=module", "--eval", RUNTIME_PROBE_ARTIFACT_WRITER_SOURCE],
    cwd: request.runDirectoryPath,
    env: {},
    envMode: "replace",
    stdin: JSON.stringify(request),
    timeoutMs: 30_000,
    outputLimitBytes: WRITER_MAX_BUFFER,
    captureLimitBytesPerStream: WRITER_MAX_BUFFER,
  });

  const response = decodeWriterResponse(result.stdout.text);
  if (!response.ok) throw new Error(response.reason);
}
