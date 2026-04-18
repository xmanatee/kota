import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROJECT_DIR_ENV_VAR, resolveProjectDir } from "./project-dir.js";

describe("resolveProjectDir", () => {
  const originalEnv = process.env[PROJECT_DIR_ENV_VAR];

  beforeEach(() => {
    delete process.env[PROJECT_DIR_ENV_VAR];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[PROJECT_DIR_ENV_VAR];
    } else {
      process.env[PROJECT_DIR_ENV_VAR] = originalEnv;
    }
  });

  it("falls back to process.cwd() when nothing is set", () => {
    expect(resolveProjectDir()).toBe(resolve(process.cwd()));
  });

  it("reads KOTA_PROJECT_DIR from the environment", () => {
    process.env[PROJECT_DIR_ENV_VAR] = "/tmp/external-project";
    expect(resolveProjectDir()).toBe(resolve("/tmp/external-project"));
  });

  it("prefers an explicit override over the env var", () => {
    process.env[PROJECT_DIR_ENV_VAR] = "/tmp/env-project";
    expect(resolveProjectDir("/tmp/override-project")).toBe(
      resolve("/tmp/override-project"),
    );
  });

  it("normalizes relative overrides against the current working directory", () => {
    expect(resolveProjectDir("./sub/dir")).toBe(resolve(process.cwd(), "sub/dir"));
  });
});
