import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

// Inject races at actual host filesystem calls; the production helper, including
// its no-follow opens and compensation, executes unchanged in a child process.
describe("anchored reads, append, listing and failed cleanup", () => {
  it.each([
    "read-leaf", "append-leaf", "append-parent", "list-parent", "list-invalid-name", "write-cleanup", "remove-cleanup",
  ] as const)("preserves outside data during %s", (scenario) => {
    const root = makeRoot("kota-filesystem-boundary-race-");
    const filesystemRoot = join(root, "scope");
    const parent = join(filesystemRoot, "files");
    const parked = join(filesystemRoot, "parked");
    const outside = join(root, "outside");
    mkdirSync(parent, { recursive: true });
    mkdirSync(outside);
    const fileName = "value.txt";
    const file = join(parent, fileName);
    const outsideFile = join(outside, fileName);
    writeFileSync(file, "inside");
    writeFileSync(outsideFile, "outside sentinel");
    const before = fileSnapshot(file);
    const preloadPath = join(root, "race.cjs");
    writeFileSync(preloadPath, `
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const original = { ...fs };
const scenario = process.env.KOTA_RACE_SCENARIO;
let fired = false;
function replaceParent() {
  original.renameSync(process.env.KOTA_RACE_PARENT, process.env.KOTA_RACE_PARKED);
  original.symlinkSync(process.env.KOTA_RACE_OUTSIDE, process.env.KOTA_RACE_PARENT);
}
fs.openSync = function(name, flags, ...rest) {
  const targetOpen = scenario === "read-leaf" ||
    (scenario === "append-leaf" && (flags & fs.constants.O_APPEND));
  if (!fired && targetOpen && name === "value.txt") {
    fired = true;
    original.unlinkSync(name);
    original.symlinkSync(process.env.KOTA_RACE_OUTSIDE_FILE, name);
  }
  return original.openSync(name, flags, ...rest);
};
fs.writeFileSync = function(fd, ...rest) {
  if (!fired && scenario === "append-parent" && typeof fd === "number") {
    fired = true;
    replaceParent();
  }
  return original.writeFileSync(fd, ...rest);
};
fs.readdirSync = function(name, ...rest) {
  // Some filesystems cannot create invalid UTF-8 names. Supply the raw OS
  // directory response at that port; production decoding still runs unchanged.
  if (scenario === "list-invalid-name" && process.cwd() === process.env.KOTA_RACE_PARENT) {
    return [Buffer.from([0xff])];
  }
  if (!fired && scenario === "list-parent" && process.cwd() === process.env.KOTA_RACE_PARENT) {
    fired = true;
    replaceParent();
  }
  return original.readdirSync(name, ...rest);
};
fs.linkSync = function(source, destination) {
  if (scenario === "write-cleanup" && destination === "new.txt") {
    original.unlinkSync(source);
    original.symlinkSync(process.env.KOTA_RACE_OUTSIDE_FILE, source);
    throw new Error("installation failed after temporary replacement");
  }
  if (scenario === "remove-cleanup") throw new Error("restore unavailable");
  return original.linkSync(source, destination);
};
fs.renameSync = function(source, destination) {
  if (!fired && scenario === "remove-cleanup" && source === "value.txt") {
    fired = true;
    original.unlinkSync(source);
    original.symlinkSync(process.env.KOTA_RACE_OUTSIDE_FILE, source);
  }
  return original.renameSync(source, destination);
};
syncBuiltinESMExports();
`);
    const rootPath = realpathSync.native(filesystemRoot);
    const stats = lstatSync(rootPath);
    const operation = scenario.startsWith("append") ? "append"
      : scenario.startsWith("read") ? "read"
      : scenario.startsWith("list") ? "list-entries"
      : scenario.startsWith("write") ? "write" : "remove";
    const response = runRacedHelper({
      preloadPath,
      env: {
        KOTA_RACE_SCENARIO: scenario,
        KOTA_RACE_PARENT: parent,
        KOTA_RACE_PARKED: parked,
        KOTA_RACE_OUTSIDE: outside,
        KOTA_RACE_OUTSIDE_FILE: outsideFile,
      },
      request: {
        operation, rootPath, rootIdentity: { dev: stats.dev, ino: stats.ino },
        parentParts: ["files"], parentPath: parent, createParent: false,
        fileName: operation === "write" ? "new.txt" : fileName,
        content: " appended", expectation: "missing", expectedSnapshot: before,
      },
    });
    expect(response.ok).toBe(scenario === "append-parent");
    if (scenario === "list-invalid-name") expect(response.reason).toContain("not lossless UTF-8");
    expect(JSON.stringify(response)).not.toContain("outside sentinel");
    expect(readFileSync(outsideFile, "utf8")).toBe("outside sentinel");
    if (scenario === "append-parent") {
      expect(readFileSync(join(parked, fileName), "utf8")).toBe("inside appended");
    }
    if (scenario === "write-cleanup" || scenario === "remove-cleanup") {
      const retained = readdirSync(parent).filter(name => name.startsWith(".anchored-file."));
      expect(retained).toHaveLength(1);
      expect(lstatSync(join(parent, retained[0]!)).isSymbolicLink()).toBe(true);
    }
  });
});
