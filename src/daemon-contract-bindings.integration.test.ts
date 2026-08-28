import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ContractDecodeError,
  parseAnswerResult,
  parseCaptureResult,
  parseMemorySearchResponse,
  parseRecallResult,
} from "../clients/conformance/daemon-contract.generated.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATOR = resolve(ROOT, "scripts/generate-daemon-contract-bindings.mjs");
const MANIFEST_PATH = "clients/conformance/daemon-contract-bindings.manifest.json";

function hashFile(root: string, path: string): string {
  return createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex");
}

function runGenerator(root: string, ...args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [GENERATOR, "--root", root, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function generatedOutputs(root: string): string[] {
  const manifest = JSON.parse(readFileSync(resolve(root, MANIFEST_PATH), "utf8")) as {
    outputs: { path: string }[];
  };
  return manifest.outputs.map((output) => output.path);
}

function prepareRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kota-daemon-bindings-"));
  cpSync(resolve(ROOT, "src"), resolve(root, "src"), { recursive: true });
  mkdirSync(resolve(root, "scripts"), { recursive: true });
  cpSync(
    resolve(ROOT, "scripts/daemon-contract-graph.mjs"),
    resolve(root, "scripts/daemon-contract-graph.mjs"),
  );
  cpSync(resolve(ROOT, "tsconfig.json"), resolve(root, "tsconfig.json"));
  return root;
}

describe("generated daemon contract bindings", () => {
  it("strictly decodes representative success and unknown discriminator behavior", () => {
    expect(parseMemorySearchResponse({
      ok: true,
      entries: [{ id: "m-1", content: "Operator preference", created: "2026-08-26" }],
    })).toMatchObject({ ok: true, entries: [{ id: "m-1" }] });

    for (const decode of [
      () => parseAnswerResult({ ok: false, reason: "future_reason" }),
      () => parseCaptureResult({
        ok: false,
        reason: "contributor_failed",
        target: "future_store",
        message: "failed",
      }),
      () => parseRecallResult({ ok: true, hits: [{ source: "future_store" }] }),
    ]) {
      expect(decode).toThrow(ContractDecodeError);
    }
  });

  it("is deterministic, detects every stale client output, and propagates a field change", () => {
    const root = prepareRoot();
    try {
      expect(runGenerator(root).status).toBe(0);
      const outputs = generatedOutputs(root);
      const first = outputs.map((path) => hashFile(root, path));
      expect(runGenerator(root).status).toBe(0);
      expect(outputs.map((path) => hashFile(root, path))).toEqual(first);
      expect(runGenerator(root, "--check").status).toBe(0);

      for (const path of outputs) {
        appendFileSync(resolve(root, path), "\n// stale\n");
        const stale = runGenerator(root, "--check");
        expect(stale.status).not.toBe(0);
        expect(stale.stderr).toContain(path);
        expect(runGenerator(root).status).toBe(0);
      }

      const sourcePath = resolve(root, "src/client/wire-contracts.ts");
      const source = readFileSync(sourcePath, "utf8");
      writeFileSync(
        sourcePath,
        source.replace("  scopeId: string;\n};", "  scopeId: string;\n  requestId?: string;\n};"),
      );
      expect(runGenerator(root).status).toBe(0);
      const changed = outputs.map((path) => hashFile(root, path));
      expect(changed.some((value, index) => value !== first[index])).toBe(true);
      expect(outputs.some((path) => readFileSync(resolve(root, path), "utf8").includes("requestId"))).toBe(true);
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true });
    }
  });
});
