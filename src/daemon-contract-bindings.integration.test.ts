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
import { ContractDecodeError as ClientContractDecodeError } from "./client/daemon-contract.generated.js";
import {
  ContractDecodeError,
  parseAnswerResult,
  parseCaptureResult,
  parseMemorySearchResponse,
  parseRecallResult,
  parseRetractResult,
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
  cpSync(
    resolve(ROOT, "scripts/kota-client-typescript.mjs"),
    resolve(root, "scripts/kota-client-typescript.mjs"),
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
    expect(parseCaptureResult({
      ok: false,
      target: "tasks",
      reason: "already_exists",
    })).toEqual({ ok: false, target: "tasks", reason: "already_exists" });
    expect(parseRetractResult({
      ok: true,
      target: "memory",
      identifier: "m-1",
    })).toEqual({ ok: true, target: "memory", identifier: "m-1" });

    for (const decode of [
      () => parseAnswerResult({ ok: false, reason: "future_reason" }),
      () => parseCaptureResult({
        ok: false,
        reason: "write_failed",
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

  it("assembles and dispatches generated routine client handlers over transport", async () => {
    const requests: { method: string; path: string; body?: unknown }[] = [];
    let captureResponse: unknown = { ok: true, target: "memory", id: "1" };
    let retractResponse: unknown = {
      ok: true,
      target: "memory",
      identifier: "1",
    };
    const mockTransport = {
      baseUrl: "http://127.0.0.1:9999",
      request: async () => null,
      requestStrict: async <T>(method: string, path: string, body?: unknown): Promise<T> => {
        requests.push({ method, path, body });
        if (path === "/agents") {
          return { agents: [] } as unknown as T;
        }
        if (path === "/skills") {
          return { skills: [] } as unknown as T;
        }
        if (path === "/recall") {
          return { ok: true, hits: [] } as unknown as T;
        }
        if (path === "/capture") {
          return captureResponse as T;
        }
        if (path === "/retract") {
          return retractResponse as T;
        }
        if (path === "/doctor/run") {
          return { checks: [] } as unknown as T;
        }
        return {} as unknown as T;
      },
    };

    const { createRoutineDaemonClientHandlers } = await import("#root/client/kota-client.generated.js");
    const routine = createRoutineDaemonClientHandlers(mockTransport as any);

    await routine.agents.list();
    expect(requests).toContainEqual({ method: "GET", path: "/agents", body: undefined });

    await routine.skills.list();
    expect(requests).toContainEqual({ method: "GET", path: "/skills", body: undefined });

    await routine.recall.recall("test query");
    expect(requests).toContainEqual({ method: "POST", path: "/recall", body: { query: "test query" } });

    await routine.capture.capture("test note");
    expect(requests).toContainEqual({ method: "POST", path: "/capture", body: { text: "test note" } });

    await routine.retract.retract({ target: "memory", identifier: "1" });
    expect(requests).toContainEqual({
      method: "POST",
      path: "/retract",
      body: { target: "memory", identifier: "1" },
    });

    captureResponse = { ok: true, target: "future_store", id: "2" };
    await expect(routine.capture.capture("malformed capture")).rejects.toBeInstanceOf(
      ClientContractDecodeError,
    );

    retractResponse = { ok: false, target: "memory", identifier: "1", reason: "future_reason" };
    await expect(
      routine.retract.retract({ target: "memory", identifier: "1" }),
    ).rejects.toBeInstanceOf(ClientContractDecodeError);

    await routine.doctor.run();
    expect(requests).toContainEqual({ method: "GET", path: "/doctor/run", body: undefined });
  });
});
