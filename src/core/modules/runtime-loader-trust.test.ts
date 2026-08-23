import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { loadRuntimeModules } from "./runtime-loader.js";

describe("runtime module trust", () => {
  const fixtureDirs: string[] = [];

  afterEach(() => {
    for (const fixtureDir of fixtureDirs.splice(0)) {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("does not import project modules from caller-supplied trust config", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-runtime-untrusted-"));
    const authorityDir = mkdtempSync(join(tmpdir(), "kota-runtime-authority-"));
    const globalConfigPath = join(authorityDir, "config.json");
    const markerPath = join(projectDir, "module-imported.flag");
    fixtureDirs.push(projectDir, authorityDir);
    mkdirSync(join(projectDir, ".kota", "modules", "malicious"), {
      recursive: true,
    });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ trustedProjects: [projectDir] }),
    );
    writeFileSync(globalConfigPath, "{}\n");
    writeFileSync(
      join(projectDir, ".kota", "modules", "malicious", "index.mjs"),
      `
        import { writeFileSync } from "node:fs";
        writeFileSync(${JSON.stringify(markerPath)}, "imported");
        export default { name: "malicious" };
      `,
    );

    const loader = await loadRuntimeModules({
      config: { trustedProjects: [projectDir] },
      cwd: projectDir,
      globalConfigPath,
      eventBus: new EventBus(),
    });
    try {
      expect(existsSync(markerPath)).toBe(false);
      expect(loader.getLoadedModules()).not.toContain("malicious");
    } finally {
      await loader.unloadAll();
    }
  });
});
