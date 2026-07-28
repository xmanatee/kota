import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureBuilderEvidenceProjectionRequest,
  captureBuilderEvidenceReadRequest,
  readAnchoredBuilderEvidenceFile,
  writeAnchoredBuilderEvidenceProjection,
} from "./agent-run-evidence-filesystem-helper.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0).reverse()) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("builder evidence identity-pinned filesystem helpers", () => {
  it("refuses a source leaf replaced by a symlink after capture", () => {
    const workspace = makeTempDir("kota-evidence-source-leaf-");
    const outside = makeTempDir("kota-evidence-source-outside-");
    const artifacts = join(workspace, ".kota", "builder-evidence", "run", "artifacts");
    mkdirSync(artifacts, { recursive: true });
    const source = join(artifacts, "transcript.txt");
    const outsideSource = join(outside, "credentials.txt");
    writeFileSync(source, "screened\n");
    writeFileSync(outsideSource, "must-not-be-read\n");
    const request = captureBuilderEvidenceReadRequest(workspace, source, 1024);

    unlinkSync(source);
    symlinkSync(outsideSource, source);

    expect(() => readAnchoredBuilderEvidenceFile(request)).toThrow(
      /filesystem operation failed \(ELOOP\)/,
    );
  });

  it("refuses a source parent replaced after its identity was captured", () => {
    const workspace = makeTempDir("kota-evidence-source-parent-");
    const outside = makeTempDir("kota-evidence-source-parent-outside-");
    const artifacts = join(workspace, ".kota", "builder-evidence", "run", "artifacts");
    const parkedArtifacts = `${artifacts}-parked`;
    mkdirSync(artifacts, { recursive: true });
    const source = join(artifacts, "transcript.txt");
    writeFileSync(source, "screened\n");
    writeFileSync(join(outside, "transcript.txt"), "must-not-be-read\n");
    const request = captureBuilderEvidenceReadRequest(workspace, source, 1024);

    renameSync(artifacts, parkedArtifacts);
    symlinkSync(outside, artifacts, "dir");

    expect(() => readAnchoredBuilderEvidenceFile(request)).toThrow(
      /evidence directory changed during projection/,
    );
  });

  it("refuses a destination leaf replaced by a symlink without touching its target", () => {
    const workspace = makeTempDir("kota-evidence-destination-leaf-");
    const outside = makeTempDir("kota-evidence-destination-outside-");
    const projection = join(workspace, ".kota", "runs", "run", "evidence");
    mkdirSync(projection, { recursive: true });
    const destination = join(projection, "success-criteria.txt");
    const outsideTarget = join(outside, "operator-file.txt");
    writeFileSync(destination, "old projection\n");
    writeFileSync(outsideTarget, "ORIGINAL\n");
    const request = captureBuilderEvidenceProjectionRequest(
      workspace,
      destination,
      Buffer.from("new projection\n"),
    );

    unlinkSync(destination);
    symlinkSync(outsideTarget, destination);

    expect(() => writeAnchoredBuilderEvidenceProjection(request)).toThrow(
      /destination must be a private regular file/,
    );
    expect(readFileSync(outsideTarget, "utf8")).toBe("ORIGINAL\n");
  });

  it("refuses a destination parent replacement without writing outside the workspace", () => {
    const workspace = makeTempDir("kota-evidence-destination-parent-");
    const outside = makeTempDir("kota-evidence-destination-parent-outside-");
    const projection = join(workspace, ".kota", "runs", "run", "evidence");
    const parkedProjection = `${projection}-parked`;
    mkdirSync(projection, { recursive: true });
    const destination = join(projection, "success-criteria.txt");
    const outsideTarget = join(outside, "success-criteria.txt");
    writeFileSync(outsideTarget, "ORIGINAL\n");
    const request = captureBuilderEvidenceProjectionRequest(
      workspace,
      destination,
      Buffer.from("new projection\n"),
    );

    renameSync(projection, parkedProjection);
    symlinkSync(outside, projection, "dir");

    expect(() => writeAnchoredBuilderEvidenceProjection(request)).toThrow(
      /projection path must be a real directory/,
    );
    expect(readFileSync(outsideTarget, "utf8")).toBe("ORIGINAL\n");
  });
});
