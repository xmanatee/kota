import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFileError, readOptionalJsonFile, writeJsonFileAtomic } from "./json-file.js";

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `kota-json-file-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("JsonFileError", () => {
  it("sets name, path, operation, and message", () => {
    const err = new JsonFileError("/some/path", "read", "something went wrong");
    expect(err.name).toBe("JsonFileError");
    expect(err.path).toBe("/some/path");
    expect(err.operation).toBe("read");
    expect(err.message).toBe("/some/path: something went wrong");
    expect(err instanceof Error).toBe(true);
  });
});

describe("readOptionalJsonFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for missing file", () => {
    const result = readOptionalJsonFile(join(tmpDir, "nonexistent.json"));
    expect(result).toBeNull();
  });

  it("returns parsed value for valid JSON", () => {
    const path = join(tmpDir, "data.json");
    writeJsonFileAtomic(path, { key: "value", num: 42 });
    const result = readOptionalJsonFile<{ key: string; num: number }>(path);
    expect(result).toEqual({ key: "value", num: 42 });
  });

  it("throws JsonFileError with operation=parse for invalid JSON", () => {
    const path = join(tmpDir, "bad.json");
    writeFileSync(path, "not valid json {{{");
    try {
      readOptionalJsonFile(path);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e instanceof JsonFileError).toBe(true);
      expect((e as JsonFileError).operation).toBe("parse");
      expect((e as JsonFileError).path).toBe(path);
    }
  });

  it("throws JsonFileError with operation=read for unreadable file", () => {
    const path = join(tmpDir, "secret.json");
    writeFileSync(path, JSON.stringify({ x: 1 }));
    chmodSync(path, 0o000);
    try {
      readOptionalJsonFile(path);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e instanceof JsonFileError).toBe(true);
      expect((e as JsonFileError).operation).toBe("read");
      expect((e as JsonFileError).path).toBe(path);
    } finally {
      chmodSync(path, 0o644);
    }
  });
});

describe("writeJsonFileAtomic", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes valid JSON with default serializer", () => {
    const path = join(tmpDir, "out.json");
    writeJsonFileAtomic(path, { hello: "world" });
    const raw = readFileSync(path, "utf-8");
    expect(JSON.parse(raw)).toEqual({ hello: "world" });
    expect(raw).toMatch(/\n$/);
  });

  it("creates missing parent directories", () => {
    const path = join(tmpDir, "nested", "deep", "file.json");
    writeJsonFileAtomic(path, [1, 2, 3]);
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual([1, 2, 3]);
  });

  it("calls custom serializer with the value", () => {
    const path = join(tmpDir, "custom.json");
    let called = false;
    let receivedValue: unknown;
    const serialize = (v: unknown) => {
      called = true;
      receivedValue = v;
      return JSON.stringify(v);
    };
    writeJsonFileAtomic(path, { a: 1 }, serialize);
    expect(called).toBe(true);
    expect(receivedValue).toEqual({ a: 1 });
    expect(readFileSync(path, "utf-8")).toBe('{"a":1}');
  });

  it("throws JsonFileError with operation=write on failure", () => {
    const readonlyDir = join(tmpDir, "readonly-dir");
    mkdirSync(readonlyDir, { recursive: true });
    chmodSync(readonlyDir, 0o555);
    const path = join(readonlyDir, "file.json");
    try {
      writeJsonFileAtomic(path, { x: 1 });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e instanceof JsonFileError).toBe(true);
      expect((e as JsonFileError).operation).toBe("write");
      expect((e as JsonFileError).path).toBe(path);
    } finally {
      chmodSync(readonlyDir, 0o755);
    }
  });
});
