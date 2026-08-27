import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_CLI_KEYCHAIN_PATH_ENV,
  prepareAntigravityCliRuntimeEnvironment,
  resolveAntigravityCliKeychainPath,
} from "./runtime-home.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Antigravity CLI runtime home", () => {
  it("projects only the login keychain into the invocation-local home", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-agy-home-"));
    roots.push(root);
    const keychainPath = join(root, "login.keychain-db");
    const invocationRoot = join(root, "invocation");
    const toolRuntimeRoot = join(invocationRoot, "tool-runtime");
    writeFileSync(keychainPath, "encrypted-keychain");
    mkdirSync(join(toolRuntimeRoot, "home"), { recursive: true });

    const prepared = prepareAntigravityCliRuntimeEnvironment({
      invocationRoot,
      toolRuntimeRoot,
      readableRoots: [],
      writableRoots: [],
      readProtectedPaths: [],
      writeProtectedPaths: [],
      readProtectedRoots: [],
      protectedRuntimeRoot: join(root, "protected-runtime"),
    }, {
      [ANTIGRAVITY_CLI_KEYCHAIN_PATH_ENV]: keychainPath,
      PATH: "/usr/bin",
    });
    const projection = join(
      toolRuntimeRoot,
      "home",
      "Library",
      "Keychains",
      "login.keychain-db",
    );
    expect(lstatSync(projection).isSymbolicLink()).toBe(true);
    expect(readlinkSync(projection)).toBe(keychainPath);
    expect(prepared[ANTIGRAVITY_CLI_KEYCHAIN_PATH_ENV]).toBeUndefined();
  });

  it("does not invent a file-backed keyring projection on other platforms", () => {
    expect(resolveAntigravityCliKeychainPath({}, "linux")).toBeUndefined();
  });

  it("rejects a missing declared login keychain", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-agy-home-"));
    roots.push(root);
    const invocationRoot = join(root, "invocation");
    const toolRuntimeRoot = join(invocationRoot, "tool-runtime");
    mkdirSync(join(toolRuntimeRoot, "home"), { recursive: true });

    expect(() => prepareAntigravityCliRuntimeEnvironment(
      {
        invocationRoot,
        toolRuntimeRoot,
        readableRoots: [],
        writableRoots: [],
        readProtectedPaths: [],
        writeProtectedPaths: [],
        readProtectedRoots: [],
        protectedRuntimeRoot: join(root, "protected-runtime"),
      },
      { [ANTIGRAVITY_CLI_KEYCHAIN_PATH_ENV]: join(root, "missing") },
    )).toThrow(/login keychain does not exist/i);
  });
});
