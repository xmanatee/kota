import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "./shared.js";

describe("runCheck", () => {
  const originalPath = process.env.PATH;

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  });

  it("resolves repo-local executables when inherited PATH is minimal", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-run-check-"));
    try {
      const binDir = join(projectDir, "node_modules", ".bin");
      mkdirSync(binDir, { recursive: true });
      const executable = join(binDir, "local-check");
      writeFileSync(executable, "#!/bin/sh\nprintf local-ok\n");
      chmodSync(executable, 0o755);
      process.env.PATH = "/usr/bin:/bin";

      expect(runCheck("local-check", projectDir)).toBe("local-ok");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("resolves the active Node runtime when inherited PATH omits it", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-run-check-"));
    try {
      process.env.PATH = "/usr/bin:/bin";

      expect(runCheck("node -e \"process.stdout.write('node-ok')\"", projectDir)).toBe(
        "node-ok",
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
