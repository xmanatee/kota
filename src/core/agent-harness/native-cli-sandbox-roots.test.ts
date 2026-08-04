import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  nativeCliReadableRoots,
  resolveNativeCliExecutable,
} from "./native-cli-sandbox-roots.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("native CLI sandbox roots", () => {
  it("resolves a PATH executable through its real identity", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-native-executable-root-"));
    roots.push(root);
    const installDirectory = join(root, "install");
    const binDirectory = join(root, "bin");
    const executable = join(installDirectory, "native-cli");
    mkdirSync(installDirectory);
    mkdirSync(binDirectory);
    writeFileSync(executable, "binary");
    symlinkSync(executable, join(binDirectory, "native-cli"));

    expect(resolveNativeCliExecutable("native-cli", { PATH: binDirectory }))
      .toBe(executable);
  });

  it("does not widen an arbitrary operator bin directory to the operator home", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-native-readable-roots-"));
    roots.push(root);
    const operatorHome = join(root, "operator");
    const operatorBin = join(operatorHome, "bin");
    const nvmRoot = join(
      operatorHome,
      ".nvm",
      "versions",
      "node",
      "v22.0.0",
    );
    const nvmBin = join(nvmRoot, "bin");
    const projectDir = join(root, "project");
    const invocationRoot = join(root, "invocation");
    mkdirSync(operatorBin, { recursive: true });
    mkdirSync(nvmBin, { recursive: true });
    mkdirSync(projectDir);
    mkdirSync(invocationRoot);

    const readableRoots = nativeCliReadableRoots(
      join(operatorBin, "native-cli"),
      projectDir,
      invocationRoot,
      { PATH: [operatorHome, operatorBin, nvmBin].join(":") },
      "linux",
    );

    expect(readableRoots).toContain(operatorBin);
    expect(readableRoots).toContain(nvmRoot);
    expect(readableRoots).not.toContain(operatorHome);
  });
});
