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
import { ANCHORED_FILE_HELPER_SOURCE } from "./anchored-file-helper-source.js";
import { listAnchoredTextFiles, readAnchoredTextFile, writeAnchoredTextFile } from "./anchored-files.js";

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
      ANCHORED_FILE_HELPER_SOURCE,
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

describe("descriptor-anchored filesystem mutations", () => {
  it("keeps removal in the verified parent when its pathname is replaced at rename", () => {
    const root = makeRoot("kota-filesystem-remove-race-");
    const filesystemRoot = join(root, "project");
    const notesDir = join(filesystemRoot, "work", "notes");
    const parkedNotesDir = join(filesystemRoot, "work", "notes-parked");
    const outsideDir = join(root, "outside");
    const fileName = "note-race.txt";
    mkdirSync(notesDir, { recursive: true });
    mkdirSync(outsideDir);
    const sourcePath = join(notesDir, fileName);
    const outsidePath = join(outsideDir, fileName);
    writeAnchoredTextFile({
      rootPath: filesystemRoot,
      boundaryDir: notesDir,
      filePath: sourcePath,
      content: "inside\n",
      expectation: "missing",
    });
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
    const rootPath = realpathSync.native(filesystemRoot);
    const rootStats = lstatSync(rootPath);

    const response = runRacedHelper({
      preloadPath,
      env: {
        KOTA_RACE_FILE: fileName,
        KOTA_RACE_OUTSIDE: outsideDir,
        KOTA_RACE_PARENT: notesDir,
        KOTA_RACE_PARKED: parkedNotesDir,
      },
      request: {
        operation: "remove",
        rootPath,
        rootIdentity: { dev: rootStats.dev, ino: rootStats.ino },
        parentParts: ["work", "notes"],
        parentPath: notesDir,
        fileName,
        createParent: false,
        expectedSnapshot: fileSnapshot(sourcePath),
      },
    });

    expect(response).toEqual({ ok: true, removed: true });
    expect(readFileSync(outsidePath, "utf8")).toBe("outside must remain\n");
    expect(readAnchoredTextFile({
      rootPath: filesystemRoot,
      boundaryDir: parkedNotesDir,
      filePath: join(parkedNotesDir, fileName),
    })).toBeNull();
  });

  it("keeps destination installation in the verified parent when replaced at link", () => {
    const root = makeRoot("kota-filesystem-write-race-");
    const filesystemRoot = join(root, "project");
    const filesDir = join(filesystemRoot, "work", "files");
    const parkedFilesDir = join(filesystemRoot, "work", "files-parked");
    const outsideDir = join(root, "outside");
    const fileName = "entry-race.json";
    mkdirSync(filesDir, { recursive: true });
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
    const rootPath = realpathSync.native(filesystemRoot);
    const rootStats = lstatSync(rootPath);

    const response = runRacedHelper({
      preloadPath,
      env: {
        KOTA_RACE_FILE: fileName,
        KOTA_RACE_OUTSIDE: outsideDir,
        KOTA_RACE_PARENT: filesDir,
        KOTA_RACE_PARKED: parkedFilesDir,
      },
      request: {
        operation: "write",
        rootPath,
        rootIdentity: { dev: rootStats.dev, ino: rootStats.ino },
        parentParts: ["work", "files"],
        parentPath: filesDir,
        fileName,
        createParent: true,
        expectation: "missing",
        content: "installed inside\n",
      },
    });

    expect(response.ok).toBe(true);
    expect(readFileSync(outsidePath, "utf8")).toBe("outside must remain\n");
    expect(listAnchoredTextFiles({
      rootPath: filesystemRoot,
      boundaryDir: parkedFilesDir,
      directoryPath: parkedFilesDir,
      nameSuffix: null,
    })).toEqual([
      expect.objectContaining({ name: fileName, content: "installed inside\n" }),
    ]);
  });
});
