import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const DEMO_SCRIPT = resolve(process.cwd(), "examples/modules/kota-demo-http.js");
type LoopbackAwareGlobal = typeof globalThis & {
  __kotaRealLoopbackAvailable?: boolean;
};

function realLoopbackAvailable(): boolean {
  return (globalThis as LoopbackAwareGlobal).__kotaRealLoopbackAvailable !== false;
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function waitForListening(proc: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    const onData = (data: Buffer) => {
      const match = data.toString().match(/Listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        proc.stderr!.off("data", onData);
        resolve(Number(match[1]));
      }
    };
    proc.stderr!.on("data", onData);
    proc.on("error", reject);
    proc.on("exit", (code) => reject(new Error(`Demo exited early with code ${code}`)));
    setTimeout(() => reject(new Error("Timed out waiting for demo to start")), 10_000);
  });
}

describe.skipIf(!existsSync(DEMO_SCRIPT) || !realLoopbackAvailable())(
  "HTTP demo module (examples/modules/kota-demo-http.js)",
  () => {
    let proc: ChildProcess | null = null;

    afterEach(() => {
      if (proc) {
        proc.kill("SIGTERM");
        proc = null;
      }
    });

    it("init → manifest, invoke → result, shutdown → ack", async () => {
      proc = spawn("node", [DEMO_SCRIPT, "0"], { stdio: ["ignore", "ignore", "pipe"] });
      const port = await waitForListening(proc);
      const url = `http://127.0.0.1:${port}`;

      const manifest = (await postJson(url, { id: "1", type: "init" })) as Record<string, unknown>;
      expect(manifest.type).toBe("manifest");
      expect(manifest.name).toBe("kota-demo-http");
      expect(Array.isArray(manifest.tools)).toBe(true);
      const tools = manifest.tools as { name: string }[];
      expect(tools.map((t) => t.name)).toContain("http_greet");
      expect(tools.map((t) => t.name)).toContain("http_echo");

      const greet = (await postJson(url, {
        id: "2",
        type: "invoke",
        name: "http_greet",
        input: { name: "KOTA" },
      })) as Record<string, unknown>;
      expect(greet.type).toBe("result");
      expect(greet.content).toContain("Hello, KOTA!");

      const echo = (await postJson(url, {
        id: "3",
        type: "invoke",
        name: "http_echo",
        input: { foo: "bar" },
      })) as Record<string, unknown>;
      expect(echo.type).toBe("result");
      expect(JSON.parse(echo.content as string)).toEqual({ foo: "bar" });

      const ack = (await postJson(url, { id: "4", type: "shutdown" })) as Record<string, unknown>;
      expect(ack.type).toBe("shutdown_ack");
    }, 15_000);
  },
);
