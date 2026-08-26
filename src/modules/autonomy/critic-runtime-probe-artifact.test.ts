import "./critic-test-fixture.integration.js";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import { runProbeIfDeclared } from "./critic-runtime-probe.js";
import { writeAnchoredRuntimeProbeArtifact } from "./critic-runtime-probe-artifact-writer.js";
import {
  commitReadyTask,
  makeRunDir,
  makeTmpDir,
  moveReadyTaskToDoing,
  writePackageJson,
} from "./critic-test-fixture.integration.js";

const fixtureRoots: string[] = [];

type ArtifactFixture = {
  artifactPath: string;
  externalTarget: string;
  markerPath: string;
  projectDir: string;
  runDir: string;
  taskContent: string;
  taskPath: string;
};

function makeArtifactFixture(program: (fixture: ArtifactFixture) => string): ArtifactFixture {
  const projectDir = makeTmpDir();
  const externalDir = makeTmpDir();
  fixtureRoots.push(projectDir, externalDir);
  const runDir = makeRunDir(projectDir);
  const fixture: ArtifactFixture = {
    artifactPath: join(runDir, "runtime-probe.json"),
    externalTarget: join(externalDir, "daemon-owned-target.json"),
    markerPath: join(projectDir, "probe-ran.txt"),
    projectDir,
    runDir,
    taskContent: [
      "---",
      "title: Artifact link probe",
      "---",
      "## Runtime Probe",
      "command: pnpm run probe:mutate",
      "timeoutMs: 5000",
    ].join("\n"),
    taskPath: join(projectDir, "data/tasks/doing/task-artifact-link.md"),
  };
  writeFileSync(fixture.externalTarget, "ORIGINAL");
  writePackageJson(projectDir, {
    "probe:mutate": `node -e ${JSON.stringify(program(fixture))}`,
  });
  commitReadyTask(
    projectDir,
    "task-artifact-link.md",
    fixture.taskContent,
  );
  moveReadyTaskToDoing(projectDir, "task-artifact-link.md");
  return fixture;
}

async function runFixture(fixture: ArtifactFixture): Promise<void> {
  await runProbeIfDeclared(
    fixture.taskContent,
    fixture.taskPath,
    fixture.projectDir,
    fixture.runDir,
    createWorkflowCommandRunner({ cwd: fixture.projectDir }),
    fixture.projectDir,
  );
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Runtime Probe artifact writes", () => {
  it("refuses a run-directory pathname swapped after its identity was captured", async () => {
    const projectDir = makeTmpDir();
    const outsideRunDir = makeTmpDir();
    const runDir = makeRunDir(projectDir);
    const relocatedRunDir = `${runDir}-relocated`;
    fixtureRoots.push(projectDir, outsideRunDir);
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
        createWorkflowCommandRunner({ cwd: projectDir }),
      ),
    ).rejects.toThrow(/run directory must not be a symbolic link/);

    expect(readFileSync(externalTarget, "utf8")).toBe("ORIGINAL");
    expect(existsSync(join(outsideRunDir, "runtime-probe.json"))).toBe(false);
    expect(existsSync(join(relocatedRunDir, "runtime-probe.json"))).toBe(false);
  });

  it("rejects a pre-planted artifact symlink after the probe without changing its target", async () => {
    const fixture = makeArtifactFixture(
      ({ markerPath }) =>
        `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "yes")`,
    );
    symlinkSync(fixture.externalTarget, fixture.artifactPath);

    await expect(runFixture(fixture)).rejects.toThrow(/must not be a symbolic link/);

    expect(readFileSync(fixture.externalTarget, "utf8")).toBe("ORIGINAL");
    expect(readFileSync(fixture.markerPath, "utf8")).toBe("yes");
  });

  it("rejects an artifact symlink created by the probe without changing its target", async () => {
    const fixture = makeArtifactFixture(
      ({ artifactPath, externalTarget, markerPath }) => [
        'const fs = require("node:fs")',
        `fs.symlinkSync(${JSON.stringify(externalTarget)}, ${JSON.stringify(artifactPath)})`,
        `fs.writeFileSync(${JSON.stringify(markerPath)}, "yes")`,
      ].join("; "),
    );

    await expect(runFixture(fixture)).rejects.toThrow(/must not be a symbolic link/);

    expect(readFileSync(fixture.externalTarget, "utf8")).toBe("ORIGINAL");
    expect(readFileSync(fixture.markerPath, "utf8")).toBe("yes");
  });

  it("rejects a non-regular artifact created by the probe", async () => {
    const fixture = makeArtifactFixture(
      ({ artifactPath, markerPath }) => [
        'const fs = require("node:fs")',
        `fs.mkdirSync(${JSON.stringify(artifactPath)})`,
        `fs.writeFileSync(${JSON.stringify(markerPath)}, "yes")`,
      ].join("; "),
    );

    await expect(runFixture(fixture)).rejects.toThrow(/must be a regular file/);

    expect(readFileSync(fixture.externalTarget, "utf8")).toBe("ORIGINAL");
    expect(readFileSync(fixture.markerPath, "utf8")).toBe("yes");
  });

  it("revalidates a probe-created run-directory link against the real workspace root", async () => {
    const outsideRunDir = makeTmpDir();
    fixtureRoots.push(outsideRunDir);
    const fixture = makeArtifactFixture(
      ({ markerPath, runDir }) => [
        'const fs = require("node:fs")',
        `fs.rmSync(${JSON.stringify(runDir)}, { recursive: true })`,
        `fs.symlinkSync(${JSON.stringify(outsideRunDir)}, ${JSON.stringify(runDir)}, "dir")`,
        `fs.writeFileSync(${JSON.stringify(markerPath)}, "yes")`,
      ].join("; "),
    );

    await expect(runFixture(fixture)).rejects.toThrow(
      /run directory must be inside the active workspace/,
    );

    expect(readFileSync(fixture.externalTarget, "utf8")).toBe("ORIGINAL");
    expect(readFileSync(fixture.markerPath, "utf8")).toBe("yes");
    expect(existsSync(join(outsideRunDir, "runtime-probe.json"))).toBe(false);
  });

  it("writes a regular artifact through the anchored directory", async () => {
    const projectDir = makeTmpDir();
    const runDir = makeRunDir(projectDir);
    fixtureRoots.push(projectDir);
    const runStats = lstatSync(runDir);

    await writeAnchoredRuntimeProbeArtifact(
      {
        expectedArtifactIdentity: null,
        runDirectoryIdentity: { dev: runStats.dev, ino: runStats.ino },
        runDirectoryPath: realpathSync.native(runDir),
        serializedArtifact: '{"status":"passed"}',
      },
      createWorkflowCommandRunner({ cwd: projectDir }),
    );

    expect(readFileSync(join(runDir, "runtime-probe.json"), "utf8")).toBe(
      '{"status":"passed"}',
    );
  });
});
