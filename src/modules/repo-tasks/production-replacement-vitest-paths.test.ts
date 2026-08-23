import { describe, expect, it } from "vitest";
import { vitestRepoPath } from "./production-replacement-vitest-paths.js";

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
});
