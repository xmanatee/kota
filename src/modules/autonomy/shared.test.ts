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

  it("resolves repo-local executables when inherited PATH is minimal", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-run-check-"));
    try {
      const binDir = join(projectDir, "node_modules", ".bin");
      mkdirSync(binDir, { recursive: true });
      const executable = join(binDir, "local-check");
      writeFileSync(executable, "#!/bin/sh\nprintf local-ok\n");
      chmodSync(executable, 0o755);
      process.env.PATH = "/usr/bin:/bin";

      await expect(runCheck("local-check", projectDir)).resolves.toBe("local-ok");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("resolves the active Node runtime when inherited PATH omits it", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-run-check-"));
    try {
      process.env.PATH = "/usr/bin:/bin";

      await expect(
        runCheck("node -e \"process.stdout.write('node-ok')\"", projectDir),
      ).resolves.toBe("node-ok");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("runs checks with the non-interactive automation environment", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-run-check-"));
    try {
      const script =
        "process.stdout.write((process.env.CI ?? '') + ':' + (process.env.GIT_OPTIONAL_LOCKS ?? ''))";
      await expect(
        runCheck(`${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`, projectDir),
      ).resolves.toBe("true:0");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("keeps the event loop responsive while a check runs", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-run-check-"));
    try {
      let completed = false;
      const check = runCheck(
        `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
          "setTimeout(() => process.stdout.write('done'), 250)",
        )}`,
        projectDir,
        { timeoutMs: 2_000 },
      ).finally(() => {
        completed = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(completed).toBe(false);
      await expect(check).resolves.toBe("done");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
