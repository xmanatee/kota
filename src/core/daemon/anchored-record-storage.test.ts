import childProcess from "node:child_process";
import {
  existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  renameSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnchoredRecordStorage } from "./anchored-record-storage.js";

// Control the OS port inside the real helper launched by the production storage.
// The request, anchoring, record operations, and response decoding remain real.
const spawnSync = childProcess.spawnSync;
function instrumentHelper(root: string, instrumentation: string): void {
  const preload = join(root, "filesystem-port.cjs");
  writeFileSync(preload, `const fs = require("node:fs");\n${instrumentation}\nrequire("node:module").syncBuiltinESMExports();`);
  vi.spyOn(childProcess, "spawnSync").mockImplementation((command, args, options) =>
    spawnSync(command, ["--require", preload, ...(args ?? [])], { ...options, timeout: 5000 }),
  );
  syncBuiltinESMExports();
}

function ioError(): string {
  return 'Object.assign(new Error("injected I/O failure"), { code: "EIO" })';
}

describe("anchored record storage", () => {
  let root: string;
  let dir: string;
  let storage: AnchoredRecordStorage;
  const filename = "deadbeef.json";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "anchored-records-"));
    dir = join(root, "records");
    storage = new AnchoredRecordStorage(dir);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  });

  it("persists private records, reopens them, and clears only the record collection", () => {
    expect(storage.read(filename)).toBeNull();
    const identity = storage.write(filename, "original", null);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, filename)).mode & 0o777).toBe(0o600);
    const reopened = new AnchoredRecordStorage(dir);
    expect(reopened.read(filename)).toEqual({ filename, contents: "original", identity });
    expect(reopened.write(filename, "updated", identity)).toEqual(identity);
    expect(storage.list()).toEqual([{ filename, contents: "updated", identity }]);
    writeFileSync(join(dir, "notes.txt"), "unrelated");
    storage.clear();
    expect(reopened.list()).toEqual([]);
    expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("unrelated");
  });

  it("rejects a linked record directory but canonicalizes an existing ancestor alias", () => {
    const linked = join(root, "linked");
    symlinkSync(dir, linked, "dir");
    expect(() => new AnchoredRecordStorage(linked)).toThrow(/symbolic links/);
    const aliased = new AnchoredRecordStorage(join(linked, "nested"));
    aliased.write(filename, "anchored", null);
    expect(readFileSync(join(dir, "nested", filename), "utf8")).toBe("anchored");
  });

  it.each(["symlink", "hardlink", "directory"] as const)(
    "rejects a %s record for every operation without changing the outside target", (kind) => {
      const outside = join(root, "outside");
      writeFileSync(outside, "outside contents");
      const target = join(dir, filename);
      if (kind === "symlink") symlinkSync(outside, target);
      else if (kind === "hardlink") linkSync(outside, target);
      else mkdirSync(target);
      const stats = statSync(target);
      const expected = { dev: stats.dev, ino: stats.ino };
      for (const operation of [
        () => storage.read(filename), () => storage.list(), () => storage.clear(),
        () => storage.write(filename, "overwrite", expected),
        () => storage.write(filename, "create", null),
      ]) expect(operation).toThrow(/symbolic link|regular file/);
      expect(readFileSync(outside, "utf8")).toBe("outside contents");
      expect(existsSync(target)).toBe(true);
    },
  );

  it("rejects invalid record names and unexpected JSON entries", () => {
    expect(() => storage.write("../outside.json", "escape", null)).toThrow(/filename/);
    writeFileSync(join(dir, "unexpected.json"), "keep");
    expect(() => storage.list()).toThrow(/filename/);
    expect(() => storage.clear()).toThrow(/filename/);
    expect(readFileSync(join(dir, "unexpected.json"), "utf8")).toBe("keep");
  });

  it("rejects replacement of a record identity and create-over-existing", () => {
    const identity = storage.write(filename, "original", null);
    const path = join(dir, filename);
    renameSync(path, join(root, "parked"));
    writeFileSync(path, "replacement");
    expect(() => storage.write(filename, "updated", identity)).toThrow(/changed/);
    expect(() => storage.write(filename, "created", null)).toThrow(/changed/);
    expect(readFileSync(path, "utf8")).toBe("replacement");
  });

  it.each(["directory", "ancestor"])("rejects a replaced %s even when the record inode survives", (kind) => {
    const parent = join(root, "parent");
    const path = join(parent, "records");
    const anchored = new AnchoredRecordStorage(path);
    const identity = anchored.write(filename, "original", null);
    if (kind === "directory") {
      renameSync(path, join(parent, "parked"));
      mkdirSync(path);
      renameSync(join(parent, "parked", filename), join(path, filename));
    } else {
      renameSync(parent, join(root, "parked"));
      mkdirSync(parent);
      renameSync(join(root, "parked", "records"), path);
    }
    for (const operation of [
      () => anchored.read(filename), () => anchored.list(), () => anchored.clear(),
      () => anchored.write(filename, "updated", identity),
    ]) expect(operation).toThrow(/directory.*changed/);
    expect(readFileSync(join(path, filename), "utf8")).toBe("original");
  });

  it.each(["create", "update"])("contains target substitution immediately before %s descriptor mutation", (operation) => {
    const identity = operation === "create" ? null : storage.write(filename, "original", null);
    const outside = join(root, "outside");
    const path = join(dir, filename);
    writeFileSync(outside, "host contents");
    instrumentHelper(root, `
const truncate = fs.ftruncateSync;
fs.ftruncateSync = (fd, length) => {
  fs.unlinkSync(${JSON.stringify(path)});
  fs.symlinkSync(${JSON.stringify(outside)}, ${JSON.stringify(path)});
  return truncate(fd, length);
};`);
    expect(() => storage.write(filename, "updated", identity)).toThrow(/changed/);
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(readFileSync(outside, "utf8")).toBe("host contents");
  });

  it("keeps record mutation anchored when its directory is redirected during a write", () => {
    const identity = storage.write(filename, "original", null);
    const parked = `${root}-parked`;
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, filename), "host contents");
    instrumentHelper(root, `
const truncate = fs.ftruncateSync;
fs.ftruncateSync = (fd, length) => {
  fs.renameSync(${JSON.stringify(dir)}, ${JSON.stringify(parked)});
  fs.symlinkSync(${JSON.stringify(outside)}, ${JSON.stringify(dir)}, "dir");
  return truncate(fd, length);
};`);
    try {
      expect(() => storage.write(filename, "updated", identity)).toThrow(/directory/);
      expect(readFileSync(join(outside, filename), "utf8")).toBe("host contents");
    } finally {
      rmSync(parked, { recursive: true, force: true });
    }
  });

  it("completes partial writes without losing multibyte or chunked contents", () => {
    instrumentHelper(root, `
const write = fs.writeSync;
fs.writeSync = (fd, buffer, offset, length, position) =>
  write(fd, buffer, offset, Math.min(length, 997), position);`);
    const contents = "🌊record".repeat(20000);
    const identity = storage.write(filename, contents, null);
    expect(storage.read(filename)?.contents).toBe(contents);
    storage.write(filename, "shorter", identity);
    expect(storage.read(filename)?.contents).toBe("shorter");
  });

  it.each(["zero", "error"])("fails a %s-progress write and removes an incomplete creation", (fault) => {
    const existingIdentity = storage.write("cafebabe.json", "original", null);
    instrumentHelper(root, `fs.writeSync = () => { ${fault === "zero" ? "return 0;" : `throw ${ioError()};`} };`);
    expect(() => storage.write(filename, "unfinished", null)).toThrow(/no progress|EIO/);
    expect(existsSync(join(dir, filename))).toBe(false);
    expect(() => storage.write("cafebabe.json", "unfinished", existingIdentity)).toThrow(/no progress|EIO/);
  });

  it.each(["not JSON", '{"ok":true}', '{"ok":true,"snapshot":{"exists":true,"contents":"record","identity":{"dev":"forged","ino":1}}}'])(
    "rejects an invalid helper response: %s", (response) => {
      instrumentHelper(root, `const write = process.stdout.write; process.stdout.write = () => write.call(process.stdout, ${JSON.stringify(response)});`);
      expect(() => storage.read(filename)).toThrow(/invalid data|omitted/);
    },
  );

  it("syncs record data and directory changes before success, including clear", () => {
    const trace = join(root, "syncs");
    instrumentHelper(root, `
const sync = fs.fsyncSync;
fs.fsyncSync = (fd) => {
  sync(fd);
  fs.appendFileSync(${JSON.stringify(trace)}, fs.fstatSync(fd).isDirectory() ? "directory\\n" : "file\\n");
};`);
    const identity = storage.write(filename, "created", null);
    expect(readFileSync(trace, "utf8")).toBe("file\ndirectory\n");
    writeFileSync(trace, "");
    storage.write(filename, "updated", identity);
    expect(readFileSync(trace, "utf8")).toBe("file\ndirectory\n");
    writeFileSync(trace, "");
    storage.clear();
    expect(readFileSync(trace, "utf8")).toBe("directory\n");
  });

  it.each(["file", "directory"])("propagates %s durability failure", (kind) => {
    const identity = storage.write(filename, "original", null);
    instrumentHelper(root, `
const sync = fs.fsyncSync;
fs.fsyncSync = (fd) => {
  if (fs.fstatSync(fd).isDirectory() === ${kind === "directory"}) throw ${ioError()};
  return sync(fd);
};`);
    expect(() => storage.write(filename, "updated", identity)).toThrow(/EIO/);
    expect(() => storage.write("cafebabe.json", "created", null)).toThrow(/EIO/);
    expect(existsSync(join(dir, "cafebabe.json"))).toBe(false);
    if (kind === "directory") expect(() => storage.clear()).toThrow(/EIO/);
  });
});
