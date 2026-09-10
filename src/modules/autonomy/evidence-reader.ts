import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, sep } from "node:path";
import { EVIDENCE_READER_SOURCE } from "./evidence-reader-source.js";

/** The caller supplies a runtime-owned root, above every candidate-writable component. */
export function readConfinedEvidenceJson(root: string, path: string): object {
  if (isAbsolute(path)) throw new Error("Evidence path must be relative to its authority root");
  root = realpathSync(root);
  const identity = lstatSync(root);
  const capture = spawnSync(process.execPath, ["--input-type=module", "--eval", EVIDENCE_READER_SOURCE], {
    input: JSON.stringify({ root, identity: { dev: identity.dev, ino: identity.ino }, parts: path.split(sep), limit: 128 * 1024 }),
    env: {}, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 5_000,
  });
  if (capture.error || capture.status !== 0) throw new Error("Scoped evidence reader unavailable");
  const response: unknown = JSON.parse(capture.stdout);
  if (!response || typeof response !== "object" || !("text" in response) || typeof response.text !== "string") {
    throw new Error("Scoped evidence identity or content could not be verified");
  }
  const raw: unknown = JSON.parse(response.text);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Evidence must be a JSON object");
  return raw;
}
