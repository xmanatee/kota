import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExtensionStorage } from "./extension-storage.js";

const tmpBase = join(process.env.TMPDIR || "/tmp", "kota-storage-test");

beforeEach(() => {
  if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  mkdirSync(tmpBase, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
});

describe("ExtensionStorage", () => {
  it("stores and retrieves JSON values", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    storage.setJSON("config", { theme: "dark", count: 42 });
    const val = storage.getJSON<{ theme: string; count: number }>("config");
    expect(val).toEqual({ theme: "dark", count: 42 });
  });

  it("returns undefined for missing JSON key", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    expect(storage.getJSON("nonexistent")).toBeUndefined();
  });

  it("stores and retrieves text values", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    storage.setText("notes", "Hello world");
    expect(storage.getText("notes")).toBe("Hello world");
  });

  it("returns undefined for missing text key", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    expect(storage.getText("missing")).toBeUndefined();
  });

  it("stores and retrieves raw files", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    storage.writeFile("readme.md", "# Module\nSome content");
    expect(storage.readFile("readme.md")).toBe("# Module\nSome content");
  });

  it("returns undefined for missing file", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    expect(storage.readFile("nope.txt")).toBeUndefined();
  });

  it("has() checks existence", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    expect(storage.has("key")).toBe(false);
    storage.setJSON("key", "value");
    expect(storage.has("key")).toBe(true);
  });

  it("hasFile() checks file existence", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    expect(storage.hasFile("data.md")).toBe(false);
    storage.writeFile("data.md", "content");
    expect(storage.hasFile("data.md")).toBe(true);
  });

  it("delete() removes key files", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    storage.setJSON("key", "value");
    storage.setText("key", "text");
    expect(storage.delete("key")).toBe(true);
    expect(storage.has("key")).toBe(false);
    expect(storage.getJSON("key")).toBeUndefined();
    expect(storage.getText("key")).toBeUndefined();
  });

  it("delete() returns false for missing key", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    expect(storage.delete("nonexistent")).toBe(false);
  });

  it("deleteFile() removes a specific file", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    storage.writeFile("temp.md", "data");
    expect(storage.deleteFile("temp.md")).toBe(true);
    expect(storage.hasFile("temp.md")).toBe(false);
  });

  it("deleteFile() returns false for missing file", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    expect(storage.deleteFile("nope.txt")).toBe(false);
  });

  it("list() returns all files sorted", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    storage.writeFile("b.md", "b");
    storage.writeFile("a.md", "a");
    storage.setJSON("config", {});
    const files = storage.list();
    expect(files).toEqual(["a.md", "b.md", "config.json"]);
  });

  it("list() returns empty for non-existent storage", () => {
    const storage = new ExtensionStorage(tmpBase, "no-storage");
    expect(storage.list()).toEqual([]);
  });

  it("listByExtension() filters by suffix", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    storage.writeFile("a.md", "a");
    storage.writeFile("b.txt", "b");
    storage.setJSON("c", {});
    expect(storage.listByExtension(".md")).toEqual(["a.md"]);
    expect(storage.listByExtension(".json")).toEqual(["c.json"]);
  });

  it("clear() removes all files", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    storage.setJSON("a", 1);
    storage.setText("b", "text");
    storage.writeFile("c.md", "md");
    expect(storage.list().length).toBe(3);
    storage.clear();
    expect(storage.list()).toEqual([]);
  });

  it("clear() is safe on non-existent storage", () => {
    const storage = new ExtensionStorage(tmpBase, "empty");
    expect(() => storage.clear()).not.toThrow();
  });

  it("isolates storage between modules", () => {
    const s1 = new ExtensionStorage(tmpBase, "mod-a");
    const s2 = new ExtensionStorage(tmpBase, "mod-b");
    s1.setJSON("key", "from-a");
    s2.setJSON("key", "from-b");
    expect(s1.getJSON("key")).toBe("from-a");
    expect(s2.getJSON("key")).toBe("from-b");
  });

  it("getDir() returns the storage directory path", () => {
    const storage = new ExtensionStorage(tmpBase, "my-mod");
    expect(storage.getDir()).toBe(join(tmpBase, ".kota", "extensions", "my-mod"));
  });

  it("sanitizes keys with special characters", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    storage.setJSON("my/key.name", { ok: true });
    expect(storage.getJSON("my/key.name")).toEqual({ ok: true });
    expect(storage.has("my/key.name")).toBe(true);
  });

  it("creates directory lazily on first write", () => {
    const storage = new ExtensionStorage(tmpBase, "lazy-mod");
    const dir = storage.getDir();
    expect(existsSync(dir)).toBe(false);
    storage.setJSON("first", "value");
    expect(existsSync(dir)).toBe(true);
  });

  it("handles corrupted JSON gracefully", () => {
    const storage = new ExtensionStorage(tmpBase, "test-mod");
    const dir = storage.getDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bad.json"), "not valid json{{{");
    expect(storage.getJSON("bad")).toBeUndefined();
  });
});
