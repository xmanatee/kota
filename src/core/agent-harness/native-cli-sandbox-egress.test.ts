import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV } from "./native-cli-egress-proxy.js";
import { buildNativeCliEnvironment } from "./native-cli-environment.js";
import {
  type NativeCliSandboxProcess,
  withNativeCliSandbox,
} from "./native-cli-sandbox.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function runNativeProcess(
  cwd: string,
  process: NativeCliSandboxProcess,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.command, process.args, {
      cwd,
      env: process.env,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("close", (status) => resolve(status));
  });
}

describe("native CLI provider-egress sandbox seam", () => {
  it("uses the upstream proxy without exposing its control marker", async () => {
    const requests: string[] = [];
    const upstream = createServer((socket) => {
      let request = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        request = Buffer.concat([request, chunk]);
        const headerEnd = request.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        requests.push(
          request.subarray(0, headerEnd).toString("ascii").split("\r\n")[0] ??
            "",
        );
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      });
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = upstream.address();
      if (address === null || typeof address === "string") {
        throw new Error("upstream test proxy did not bind to TCP");
      }
      const scopeRoot = mkdtempSync(join(tmpdir(), "kota-native-upstream-"));
      roots.push(scopeRoot);
      const script = [
        'const { connect } = require("node:net")',
        `if (process.env.${NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV} !== undefined) process.exit(24)`,
        'const proxy = new URL(process.env.HTTPS_PROXY)',
        'const socket = connect({ host: proxy.hostname, port: Number(proxy.port) })',
        'let response = ""',
        'socket.once("connect", () => socket.write("CONNECT chatgpt.com:443 HTTP/1.1\\r\\nHost: chatgpt.com:443\\r\\n\\r\\n"))',
        'socket.on("data", (chunk) => { response += chunk; if (response.includes("\\r\\n\\r\\n")) process.exit(response.startsWith("HTTP/1.1 200 Connection Established") ? 0 : 22) })',
        'socket.once("error", () => process.exit(23))',
        'setTimeout(() => process.exit(21), 2000)',
      ].join("; ");

      const status = await withNativeCliSandbox(
        process.execPath,
        ["-e", script],
        {
          cwd: scopeRoot,
          machineAuthorityOwner: "native-cli",
          writableRoots: [],
          env: buildNativeCliEnvironment({
            overrides: {
              [NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV]:
                `http://127.0.0.1:${address.port}`,
            },
          }),
          allowedEgressHosts: ["chatgpt.com"],
        },
        (sandboxedProcess) => runNativeProcess(scopeRoot, sandboxedProcess),
      );

      expect(status).toBe(0);
      expect(requests).toEqual(["CONNECT chatgpt.com:443 HTTP/1.1"]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        upstream.close((error) => error === undefined ? resolve() : reject(error));
      });
    }
  });
});
