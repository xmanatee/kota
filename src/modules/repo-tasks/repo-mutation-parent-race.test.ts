import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_MUTATION_FILESYSTEM_HELPER_SOURCE } from "./repo-mutation-filesystem-helper-source.js";

const roots: string[] = [];

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function fileSnapshot(path: string): {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
} {
  const stats = statSync(path);
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
  };
}

function runRacedHelper(args: {
  preloadPath: string;
  request: object;
  env: NodeJS.ProcessEnv;
}): { ok: boolean; reason?: string } {
  const result = spawnSync(
    process.execPath,
    [
      "--require",
      args.preloadPath,
      "--input-type=module",
      "--eval",
      REPO_MUTATION_FILESYSTEM_HELPER_SOURCE,
    ],
    {
      encoding: "utf8",
      env: args.env,
      input: JSON.stringify(args.request),
    },
  );
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as { ok: boolean; reason?: string };
}

afterEach(() => {
  for (const root of roots.splice(0).reverse()) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("descriptor-anchored repo mutations", () => {
  it("keeps removal in the verified parent when its pathname is replaced at rename", () => {
    const root = makeRoot("kota-repo-remove-race-");
    const repoRoot = join(root, "project");
    const inboxDir = join(repoRoot, "data", "inbox");
    const parkedInboxDir = join(repoRoot, "data", "inbox-parked");
    const outsideDir = join(root, "outside");
    const fileName = "note-race.md";
    mkdirSync(inboxDir, { recursive: true });
    mkdirSync(outsideDir);
    const sourcePath = join(inboxDir, fileName);
    const outsidePath = join(outsideDir, fileName);
    writeFileSync(sourcePath, "inside\n");
    writeFileSync(outsidePath, "outside must remain\n");
    const preloadPath = join(root, "replace-parent-before-rename.cjs");
    writeFileSync(
      preloadPath,
      `const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const originalRenameSync = fs.renameSync;
let replaced = false;
fs.renameSync = function renameSync(source, destination) {
  if (!replaced && source === process.env.KOTA_RACE_FILE) {
    replaced = true;
    originalRenameSync(process.env.KOTA_RACE_PARENT, process.env.KOTA_RACE_PARKED);
    fs.symlinkSync(process.env.KOTA_RACE_OUTSIDE, process.env.KOTA_RACE_PARENT, "dir");
  }
  return originalRenameSync(source, destination);
};
syncBuiltinESMExports();
`,
    );
    const repoRootPath = realpathSync.native(repoRoot);
    const repoStats = lstatSync(repoRootPath);

    const response = runRacedHelper({
      preloadPath,
      env: {
        KOTA_RACE_FILE: fileName,
        KOTA_RACE_OUTSIDE: outsideDir,
        KOTA_RACE_PARENT: inboxDir,
        KOTA_RACE_PARKED: parkedInboxDir,
      },
      request: {
        operation: "remove",
        repoRootPath,
        repoRootIdentity: { dev: repoStats.dev, ino: repoStats.ino },
        parentParts: ["data", "inbox"],
        parentPath: inboxDir,
        fileName,
        createParent: false,
        expectedSnapshot: fileSnapshot(sourcePath),
      },
    });

    expect(response).toEqual({ ok: true, removed: true });
    expect(readFileSync(outsidePath, "utf8")).toBe("outside must remain\n");
    expect(() => readFileSync(join(parkedInboxDir, fileName), "utf8")).toThrow();
  });

  it("keeps destination installation in the verified parent when replaced at link", () => {
    const root = makeRoot("kota-repo-write-race-");
    const repoRoot = join(root, "project");
    const tasksDir = join(repoRoot, "data", "tasks");
    const parkedTasksDir = join(repoRoot, "data", "tasks-parked");
    const outsideDir = join(root, "outside");
    const fileName = "task-race.md";
    mkdirSync(tasksDir, { recursive: true });
    mkdirSync(outsideDir);
    const outsidePath = join(outsideDir, fileName);
    writeFileSync(outsidePath, "outside must remain\n");
    const preloadPath = join(root, "replace-parent-before-link.cjs");
    writeFileSync(
      preloadPath,
      `const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const originalLinkSync = fs.linkSync;
const originalRenameSync = fs.renameSync;
let replaced = false;
fs.linkSync = function linkSync(source, destination) {
  if (!replaced && destination === process.env.KOTA_RACE_FILE) {
    replaced = true;
    originalRenameSync(process.env.KOTA_RACE_PARENT, process.env.KOTA_RACE_PARKED);
    fs.symlinkSync(process.env.KOTA_RACE_OUTSIDE, process.env.KOTA_RACE_PARENT, "dir");
  }
  return originalLinkSync(source, destination);
};
syncBuiltinESMExports();
`,
    );
    const repoRootPath = realpathSync.native(repoRoot);
    const repoStats = lstatSync(repoRootPath);

    const response = runRacedHelper({
      preloadPath,
      env: {
        KOTA_RACE_FILE: fileName,
        KOTA_RACE_OUTSIDE: outsideDir,
        KOTA_RACE_PARENT: tasksDir,
        KOTA_RACE_PARKED: parkedTasksDir,
      },
      request: {
        operation: "write",
        repoRootPath,
        repoRootIdentity: { dev: repoStats.dev, ino: repoStats.ino },
        parentParts: ["data", "tasks"],
        parentPath: tasksDir,
        fileName,
        createParent: true,
        expectation: "missing",
        content: "installed inside\n",
      },
    });

    expect(response.ok).toBe(true);
    expect(readFileSync(outsidePath, "utf8")).toBe("outside must remain\n");
    expect(readFileSync(join(parkedTasksDir, fileName), "utf8")).toBe(
      "installed inside\n",
    );
  });
});
