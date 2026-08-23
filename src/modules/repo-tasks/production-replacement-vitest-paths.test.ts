import { describe, expect, it } from "vitest";
import {
  collectTransformedRepoPaths,
  vitestRepoPath,
} from "./production-replacement-vitest-paths.js";

describe("production replacement Vitest paths", () => {
  const projectDir = "/var/folders/T/replacement-proof-123";

  it("normalizes direct and Vite-root-relative production paths", () => {
    expect(vitestRepoPath(projectDir, `${projectDir}/src/live-runtime.ts`))
      .toBe("src/live-runtime.ts");
    expect(vitestRepoPath(projectDir, "/src/live-runtime.ts?direct"))
      .toBe("src/live-runtime.ts");
    expect(vitestRepoPath(projectDir, `file://${projectDir}/clients/web/runtime.ts`))
      .toBe("clients/web/runtime.ts");
  });

  it("normalizes a sandbox projection only when it contains the exact project root", () => {
    const projected =
      "/private/var/folders/T/tool-runtime/replacement-proof-123/src/live-runtime.ts";
    expect(vitestRepoPath(projectDir, projected)).toBe("src/live-runtime.ts");
    expect(vitestRepoPath(projectDir, "/tmp/another-project/src/live-runtime.ts"))
      .toBeNull();
  });

  it("collects transformed paths without accepting unrelated debug output", () => {
    const stderr = [
      "2026-08-23T06:00:00.000Z vite:transform 1.2ms \u001B[90m/src/live-runtime.ts\u001B[39m",
      "2026-08-23T06:00:00.001Z vite:transform 0.7ms " +
        "/private/var/folders/T/tool-runtime/replacement-proof-123/src/restart-runtime.ts +2ms",
      "ordinary stderr",
    ].join("\n");
    expect([...collectTransformedRepoPaths(projectDir, stderr)]).toEqual([
      "src/live-runtime.ts",
      "src/restart-runtime.ts",
    ]);
  });
});
