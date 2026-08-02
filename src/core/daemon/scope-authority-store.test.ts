import { type ChildProcess, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ScopeAuthorityStore } from "./scope-authority-store.js";

const tempRoots: string[] = [];

const CHILD_SOURCE = String.raw`
  import { existsSync, writeFileSync } from "node:fs";

  const [storeModuleUrl, configPath, readyPath, startPath, projectPrefix] = process.argv.slice(1);
  const { ScopeAuthorityStore } = await import(storeModuleUrl);
  const store = new ScopeAuthorityStore(configPath);
  const initial = store.read();
  if (initial.metadata.revision !== 0) throw new Error("expected revision zero before race");
  const trustedProjects = Array.from(
    { length: 50_000 },
    (_, index) => projectPrefix + "-" + index,
  );
  writeFileSync(readyPath, "ready\n", { mode: 0o600 });
  while (!existsSync(startPath)) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  try {
    await store.commit(0, {
      trustedProjects,
      scopePolicies: [],
      metadata: { schema: 1, revision: 1, audit: [] },
    });
    process.stdout.write("committed");
  } catch (error) {
    if (error instanceof Error && error.name === "ScopeAuthorityRevisionConflictError") {
      process.stdout.write("revision-conflict");
    } else {
      throw error;
    }
  }
`;

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ScopeAuthorityStore", () => {
  it("queues simultaneous ticket publication and lets only one process commit a revision", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-authority-store-race-"));
    tempRoots.push(root);
    const configPath = join(root, "config.json");
    const startPath = join(root, "start");
    const lockRoot = join(root, `.${basename(configPath)}.scope-authority.lock`);
    mkdirSync(lockRoot, { mode: 0o700 });
    for (let number = 1; number <= 32; number += 1) {
      writeFileSync(
        join(lockRoot, `ticket-${number}`),
        `${JSON.stringify({
          pid: 2_147_483_647,
          token: `dead-${number}`,
          acquiredAt: "2000-01-01T00:00:00.000Z",
        })}\n`,
        { mode: 0o600 },
      );
    }
    const storeModuleUrl = pathToFileURL(
      join(process.cwd(), "src/core/daemon/scope-authority-store.ts"),
    ).href;
    const contenders = ["first", "second"].map((name) => {
      const readyPath = join(root, `${name}.ready`);
      const child = spawn(process.execPath, [
        "--conditions=source",
        "--import",
        "tsx",
        "--eval",
        CHILD_SOURCE,
        storeModuleUrl,
        configPath,
        readyPath,
        startPath,
        join(root, name),
      ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
      return { child, completion: collectChild(child), readyPath };
    });

    await Promise.all(contenders.map(({ completion, readyPath }) =>
      waitForFile(readyPath, completion)));
    writeFileSync(startPath, "start\n", { mode: 0o600 });
    const results = await Promise.all(contenders.map(({ completion }) => completion));

    expect(results.map(({ stdout }) => stdout).sort()).toEqual([
      "committed",
      "revision-conflict",
    ]);
    const stored = new ScopeAuthorityStore(configPath).read();
    expect(stored.metadata.revision).toBe(1);
    expect(stored.trustedProjects).toHaveLength(50_000);
    expect(stored.trustedProjects.every((path) => path.startsWith(`${root}/first-`)) ||
      stored.trustedProjects.every((path) => path.startsWith(`${root}/second-`))).toBe(true);
    expect(readdirSync(lockRoot).sort()).toEqual(expect.arrayContaining([
      "ticket-33",
      "ticket-34",
      "released-33",
      "released-34",
    ]));
  }, 20_000);
});

async function waitForFile(path: string, child: Promise<{ stdout: string }>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!existsSync(path)) {
    const exited = await Promise.race([
      child.then(({ stdout }) => `child exited before readiness with output: ${stdout}`),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10)),
    ]);
    if (exited !== null) throw new Error(exited);
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for child readiness: ${path}`);
  }
}

function collectChild(child: ChildProcess): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stdout });
      else reject(new Error(`Authority race child exited ${code}: ${stderr}`));
    });
  });
}
