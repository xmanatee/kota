import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const TIMEOUT_MS = 120_000;

function run(command: string, args: string[], cwd: string) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "" },
    timeout: TIMEOUT_MS,
  });
}

function expectRunOk(command: string, args: string[], cwd: string): string {
  const result = run(command, args, cwd);
  expect(
    result.status,
    `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  ).toBe(0);
  return result.stdout;
}

function listNamedFiles(root: string, name: string, current = root): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) paths.push(...listNamedFiles(root, name, path));
    else if (entry.isFile() && entry.name === name) paths.push(relative(root, path));
  }
  return paths.sort();
}

describe("published package", () => {
  let tempDir: string;
  let packageRoot: string;
  let consumerDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kota-package-consumer-"));
    const packOutput = expectRunOk(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", tempDir],
      REPO_ROOT,
    );
    const [{ filename }] = JSON.parse(packOutput) as Array<{ filename: string }>;
    expectRunOk("tar", ["-xzf", join(tempDir, filename), "-C", tempDir], tempDir);

    packageRoot = join(tempDir, "package");
    consumerDir = join(tempDir, "consumer");
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    if (manifest.dependencies?.["@types/node"] === undefined) {
      throw new Error("The published declaration graph requires @types/node as a dependency.");
    }
    mkdirSync(join(consumerDir, "node_modules"), { recursive: true });
    symlinkSync(join(REPO_ROOT, "node_modules"), join(packageRoot, "node_modules"), "dir");
    symlinkSync(packageRoot, join(consumerDir, "node_modules", "kota"), "dir");
    symlinkSync(
      join(REPO_ROOT, "node_modules", "@types"),
      join(consumerDir, "node_modules", "@types"),
      "dir",
    );
  }, TIMEOUT_MS);

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("contains only built surfaces and all package-safe fixture manifests", () => {
    expect(existsSync(join(packageRoot, "src"))).toBe(false);
    expect(existsSync(join(packageRoot, "dist", "module-api.d.ts"))).toBe(true);
    expect(
      existsSync(
        join(
          packageRoot,
          "dist/assets/src/modules/eval-harness/fixtures/",
          "builder-cross-hierarchy-debugging/initial/fixture.gitignore",
        ),
      ),
    ).toBe(true);
    const sourceFixtures = join(
      REPO_ROOT,
      "src/modules/eval-harness/fixtures",
    );
    const packedFixtures = join(
      packageRoot,
      "dist/assets/src/modules/eval-harness/fixtures",
    );
    const sourceIgnoreFiles = listNamedFiles(sourceFixtures, "fixture.gitignore");
    expect(sourceIgnoreFiles.length).toBeGreaterThan(0);
    expect(listNamedFiles(packedFixtures, "fixture.gitignore"))
      .toEqual(sourceIgnoreFiles);
  });

  it("typechecks both public exports from a strict external consumer", () => {
    writeFileSync(
      join(consumerDir, "consumer.ts"),
      [
        'import type { KotaModule } from "kota/module";',
        'import type { HarnessOptions } from "kota/testing";',
        "const moduleContract: KotaModule | null = null;",
        "const harnessOptions: HarnessOptions | null = null;",
        "void moduleContract;",
        "void harnessOptions;",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(consumerDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "ES2022",
        },
        include: ["consumer.ts"],
      }),
    );

    expectRunOk(
      process.execPath,
      [join(REPO_ROOT, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
      consumerDir,
    );
  });

  it("runs the installed CLI and discovers shipped eval fixtures outside the repo", () => {
    const bin = join(packageRoot, "bin", "kota.mjs");
    expect(expectRunOk(process.execPath, [bin, "task", "--help"], consumerDir))
      .toContain("Usage:");

    const fixtures = JSON.parse(
      expectRunOk(process.execPath, [bin, "eval", "list", "--json"], consumerDir),
    ) as { fixtures: Array<{ id: string }> };
    expect(fixtures.fixtures.length).toBeGreaterThan(0);
    expect(fixtures.fixtures.map((fixture) => fixture.id)).toContain(
      "builder-cross-hierarchy-debugging",
    );
  });
});
