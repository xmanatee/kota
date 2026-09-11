import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModuleStorage, ModuleStorageJsonError } from "./module-storage.js";

const tmpBase = join(process.env.TMPDIR || "/tmp", "kota-storage-test");

beforeEach(() => {
  if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  mkdirSync(tmpBase, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
});

describe("ModuleStorage", () => {
  it("stores and retrieves JSON values", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    storage.setJSON("config", { theme: "dark", count: 42 });
    const val = storage.getJSON("config");
    expect(val).toEqual({ theme: "dark", count: 42 });
  });

  it("returns undefined for missing JSON key", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    expect(storage.getJSON("nonexistent")).toBeUndefined();
  });

  it("stores and retrieves text values", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    storage.setText("notes", "Hello world");
    expect(storage.getText("notes")).toBe("Hello world");
  });

  it("returns undefined for missing text key", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    expect(storage.getText("missing")).toBeUndefined();
  });

  it("stores and retrieves raw files", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    storage.writeFile("readme.md", "# Module\nSome content");
    expect(storage.readFile("readme.md")).toBe("# Module\nSome content");
  });

  it("returns undefined for missing file", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    expect(storage.readFile("nope.txt")).toBeUndefined();
  });

  it("has() checks existence", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    expect(storage.has("key")).toBe(false);
    storage.setJSON("key", "value");
    expect(storage.has("key")).toBe(true);
  });

  it("hasFile() checks file existence", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    expect(storage.hasFile("data.md")).toBe(false);
    storage.writeFile("data.md", "content");
    expect(storage.hasFile("data.md")).toBe(true);
  });

  it("delete() removes key files", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    storage.setJSON("key", "value");
    storage.setText("key", "text");
    expect(storage.delete("key")).toBe(true);
    expect(storage.has("key")).toBe(false);
    expect(storage.getJSON("key")).toBeUndefined();
    expect(storage.getText("key")).toBeUndefined();
  });

  it("delete() returns false for missing key", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    expect(storage.delete("nonexistent")).toBe(false);
  });

  it("deleteFile() removes a specific file", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    storage.writeFile("temp.md", "data");
    expect(storage.deleteFile("temp.md")).toBe(true);
    expect(storage.hasFile("temp.md")).toBe(false);
  });

  it("deleteFile() returns false for missing file", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    expect(storage.deleteFile("nope.txt")).toBe(false);
  });

  it("list() returns all files sorted", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    storage.writeFile("b.md", "b");
    storage.writeFile("a.md", "a");
    storage.setJSON("config", {});
    const files = storage.list();
    expect(files).toEqual(["a.md", "b.md", "config.json"]);
  });

  it("list() returns empty for non-existent storage", () => {
    const storage = new ModuleStorage(tmpBase, "no-storage");
    expect(storage.list()).toEqual([]);
  });

  it("listByExtension() filters by suffix", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    storage.writeFile("a.md", "a");
    storage.writeFile("b.txt", "b");
    storage.setJSON("c", {});
    expect(storage.listByExtension(".md")).toEqual(["a.md"]);
    expect(storage.listByExtension(".json")).toEqual(["c.json"]);
  });

  it("clear() removes all files", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    storage.setJSON("a", 1);
    storage.setText("b", "text");
    storage.writeFile("c.md", "md");
    expect(storage.list().length).toBe(3);
    storage.clear();
    expect(storage.list()).toEqual([]);
  });

  it("clear() is safe on non-existent storage", () => {
    const storage = new ModuleStorage(tmpBase, "empty");
    expect(() => storage.clear()).not.toThrow();
  });

  it("isolates storage between modules", () => {
    const s1 = new ModuleStorage(tmpBase, "mod-a");
    const s2 = new ModuleStorage(tmpBase, "mod-b");
    s1.setJSON("key", "from-a");
    s2.setJSON("key", "from-b");
    expect(s1.getJSON("key")).toBe("from-a");
    expect(s2.getJSON("key")).toBe("from-b");
  });

  it("getDir() returns the storage directory path", () => {
    const storage = new ModuleStorage(tmpBase, "my-mod");
    expect(storage.getDir()).toBe(join(tmpBase, ".kota", "modules", "my-mod"));
  });

  it("rejects ambiguous keys while preserving legacy filenames and distinct valid keys", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    storage.writeFile("first_key.json", '{"legacy":true}');
    for (const key of ["first/key", "first?key", "", "../key"]) {
      expect(() => storage.setJSON(key, "replacement")).toThrow("Invalid module storage key");
      expect(() => storage.getJSON(key)).toThrow("Invalid module storage key");
    }
    storage.setJSON("first-key", "separate");
    expect(storage.getJSON("first_key")).toEqual({ legacy: true });
    expect(storage.getJSON("first-key")).toBe("separate");
    expect(storage.readFile("first_key.json")).toBe('{"legacy":true}');
  });

  it("rejects traversal in module names and exact filenames before creating storage", () => {
    for (const name of ["", ".", "..", "../escape", "/escape", "a\\b", "a\0b", "\ud800"]) {
      expect(() => new ModuleStorage(tmpBase, name)).toThrow("Invalid module name");
    }
    const storage = new ModuleStorage(tmpBase, "test-mod");
    for (const filename of ["../../../escaped.txt", "/escaped.txt", "..", "nested/file", "a\\b", "a\0b", "\ud800.txt"]) {
      expect(() => storage.writeFile(filename, "sentinel")).toThrow("Invalid module filename");
      expect(() => storage.readFile(filename)).toThrow("Invalid module filename");
      expect(() => storage.deleteFile(filename)).toThrow("Invalid module filename");
    }
    expect(existsSync(storage.getDir())).toBe(false);
  });

  it.each([".kota", ".kota/modules", ".kota/modules/test-mod", ".kota/modules/test-mod/value.txt"])(
    "rejects linked storage at %s without reading, overwriting, or cleaning outside files", (relativePath) => {
      const outside = join(tmpBase, "outside");
      mkdirSync(outside);
      const sentinel = join(outside, "value.txt");
      writeFileSync(sentinel, "outside");
      const link = join(tmpBase, relativePath);
      mkdirSync(join(link, ".."), { recursive: true });
      symlinkSync(relativePath.endsWith(".txt") ? sentinel : outside, link);
      const storage = new ModuleStorage(tmpBase, "test-mod");
      for (const operation of [
        () => storage.readFile("value.txt"), () => storage.writeFile("value.txt", "overwrite"),
        () => storage.deleteFile("value.txt"), () => storage.list(), () => storage.clear(),
      ]) expect(operation).toThrow("Unsafe filesystem path");
      expect(readFileSync(sentinel, "utf8")).toBe("outside");
    },
  );

  it("creates directory lazily on first write", () => {
    const storage = new ModuleStorage(tmpBase, "lazy-mod");
    const dir = storage.getDir();
    expect(existsSync(dir)).toBe(false);
    storage.setJSON("first", "value");
    expect(existsSync(dir)).toBe(true);
  });

  it("reports corrupted JSON instead of treating durable data as absent", () => {
    const storage = new ModuleStorage(tmpBase, "test-mod");
    const dir = storage.getDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bad.json"), "not valid json{{{");
    expect(() => storage.getJSON("bad")).toThrowError(ModuleStorageJsonError);
  });
});

it("never aliases admitted key or module spelling on case-insensitive filesystems", () => {
  const storage = new ModuleStorage(tmpBase, "case-probe");
  storage.setJSON("Key", "original");
  try { storage.setJSON("key", "distinct"); } catch (error) {
    expect(String(error)).toContain("spelling aliases");
  }
  expect(storage.getJSON("Key")).toBe("original");
  try { new ModuleStorage(tmpBase, "CASE-PROBE").setJSON("Key", "another module"); } catch (error) {
    expect(String(error)).toContain("spelling aliases");
  }
  expect(storage.getJSON("Key")).toBe("original");
});
