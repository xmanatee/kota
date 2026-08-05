import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareNativeCliPackageManagerRuntime } from "./native-cli-package-manager.js";

describe("native CLI package manager runtime", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("projects the exact pnpm runtime declared by the nearest project", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-native-pnpm-"));
    roots.push(root);
    const projectDir = join(root, "project");
    const invocationRoot = join(root, "invocation");
    const corepackHome = join(root, "corepack");
    const packageRoot = join(corepackHome, "v1", "pnpm", "10.32.1");
    const executable = join(packageRoot, "bin", "pnpm.cjs");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(packageRoot, "bin"), { recursive: true });
    mkdirSync(invocationRoot, { recursive: true });
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ packageManager: "pnpm@10.32.1" }),
    );
    writeFileSync(executable, "");

    const runtime = prepareNativeCliPackageManagerRuntime(
      projectDir,
      invocationRoot,
      { PATH: "/usr/bin" },
      { COREPACK_HOME: corepackHome },
    );

    const [shimDirectory] = runtime.env.PATH!.split(delimiter);
    expect(realpathSync.native(join(shimDirectory!, "pnpm"))).toBe(
      realpathSync.native(executable),
    );
    expect(runtime.readOnlyHostRoots).toEqual([packageRoot]);
  });
});
