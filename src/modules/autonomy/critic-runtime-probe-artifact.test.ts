import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import { writeAnchoredRuntimeProbeArtifact } from "./critic-runtime-probe-artifact-writer.js";

const fixtureRoots: string[] = [];

function makeTmpDir(): string {
  const root = mkdtempSync(join(tmpdir(), "kota-probe-artifact-"));
  fixtureRoots.push(root);
  return root;
}

function makeRunDir(root: string): string {
  const runDir = join(root, ".kota", "runs", "test-run");
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Runtime Probe artifact writes", () => {
  it("refuses a run-directory pathname swapped after its identity was captured", async () => {
    const workspaceRoot = makeTmpDir();
    const outsideRunDir = makeTmpDir();
    const runDir = makeRunDir(workspaceRoot);
    const relocatedRunDir = `${runDir}-relocated`;
    const runStats = lstatSync(runDir);
    const externalTarget = join(outsideRunDir, "daemon-owned-target.json");
    writeFileSync(externalTarget, "ORIGINAL");

    renameSync(runDir, relocatedRunDir);
    symlinkSync(outsideRunDir, runDir, "dir");

    await expect(
      writeAnchoredRuntimeProbeArtifact(
        {
          expectedArtifactIdentity: null,
          runDirectoryIdentity: { dev: runStats.dev, ino: runStats.ino },
          runDirectoryPath: runDir,
          serializedArtifact: '{"status":"passed"}',
        },
        createWorkflowCommandRunner({ cwd: workspaceRoot }),
      ),
    ).rejects.toThrow(/run directory must not be a symbolic link/);

    expect(readFileSync(externalTarget, "utf8")).toBe("ORIGINAL");
    expect(existsSync(join(outsideRunDir, "runtime-probe.json"))).toBe(false);
    expect(existsSync(join(relocatedRunDir, "runtime-probe.json"))).toBe(false);
  });

  it.each(["symlink", "directory", "hardlink", "replaced-file"] as const)(
    "rejects an artifact replaced with a %s before publication",
    async (replacement) => {
      const root = makeTmpDir();
      const outside = makeTmpDir();
      const runDir = makeRunDir(root);
      const artifactPath = join(runDir, "runtime-probe.json");
      const externalTarget = join(outside, "original.json");
      writeFileSync(externalTarget, "ORIGINAL");
      writeFileSync(artifactPath, "PREVIOUS");
      const expectedArtifactIdentity = lstatSync(artifactPath);
      const runDirectoryIdentity = lstatSync(runDir);
      // Retain the old inode so a new file cannot reuse its identity.
      renameSync(artifactPath, `${artifactPath}.previous`);
      switch (replacement) {
        case "symlink": symlinkSync(externalTarget, artifactPath); break;
        case "directory": mkdirSync(artifactPath); break;
        case "hardlink": linkSync(externalTarget, artifactPath); break;
        case "replaced-file": writeFileSync(artifactPath, "REPLACEMENT"); break;
      }
      await expect(writeAnchoredRuntimeProbeArtifact({
        expectedArtifactIdentity,
        runDirectoryIdentity,
        runDirectoryPath: runDir,
        serializedArtifact: '{"status":"passed"}',
      }, createWorkflowCommandRunner({ cwd: root }))).rejects.toThrow(/Runtime Probe artifact/);
      expect(readFileSync(externalTarget, "utf8")).toBe("ORIGINAL");
      expect(readFileSync(`${artifactPath}.previous`, "utf8")).toBe("PREVIOUS");
      if (replacement === "replaced-file") {
        expect(readFileSync(artifactPath, "utf8")).toBe("REPLACEMENT");
      }
    },
  );

  it("writes a regular artifact through the anchored directory", async () => {
    const workspaceRoot = makeTmpDir();
    const runDir = makeRunDir(workspaceRoot);
    const runStats = lstatSync(runDir);

    await writeAnchoredRuntimeProbeArtifact(
      {
        expectedArtifactIdentity: null,
        runDirectoryIdentity: { dev: runStats.dev, ino: runStats.ino },
        runDirectoryPath: realpathSync.native(runDir),
        serializedArtifact: '{"status":"passed"}',
      },
      createWorkflowCommandRunner({ cwd: workspaceRoot }),
    );

    expect(readFileSync(join(runDir, "runtime-probe.json"), "utf8")).toBe(
      '{"status":"passed"}',
    );
  });
});
