import { createConnection, createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  type NativeCliEgressProxy,
  startNativeCliEgressProxy,
} from "./native-cli-egress-proxy.js";

const proxies: NativeCliEgressProxy[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
});

async function proxyResponse(
  proxy: NativeCliEgressProxy,
  request: string,
): Promise<string> {
  if (proxy.address.kind !== "tcp") {
    throw new Error("test proxy must use a TCP listener");
  }
  const address = proxy.address;
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = createConnection({
      host: address.host,
      port: address.port,
    });
    socket.once("connect", () => socket.end(request));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("end", () => resolve(Buffer.concat(chunks).toString("ascii")));
    socket.once("error", reject);
  });
}

async function proxyConnectResponse(
  proxy: NativeCliEgressProxy,
  request: string,
): Promise<string> {
  if (proxy.address.kind !== "tcp") {
    throw new Error("test proxy must use a TCP listener");
  }
  const address = proxy.address;
  return await new Promise<string>((resolve, reject) => {
    let response = Buffer.alloc(0);
    const socket = createConnection({
      host: address.host,
      port: address.port,
    });
    socket.once("connect", () => socket.write(request));
    socket.on("data", (chunk: Buffer) => {
      response = Buffer.concat([response, chunk]);
      if (response.indexOf("\r\n\r\n") < 0) return;
      socket.destroy();
      resolve(response.toString("ascii"));
    });
    socket.once("error", reject);
  });
}

describe("native CLI provider egress proxy", () => {
  it("rejects CONNECT targets outside the harness provider allowlist", async () => {
    const proxy = await startNativeCliEgressProxy(["chatgpt.com"]);
    proxies.push(proxy);

    const response = await proxyResponse(
      proxy,
      "CONNECT attacker.example:443 HTTP/1.1\r\nHost: attacker.example:443\r\n\r\n",
    );
    expect(response.startsWith("HTTP/1.1 403 Forbidden")).toBe(true);
  });

  it("rejects raw and non-TLS proxy traffic before opening an upstream", async () => {
    const proxy = await startNativeCliEgressProxy(["chatgpt.com"]);
    proxies.push(proxy);

    const rawResponse = await proxyResponse(
      proxy,
      "GET http://chatgpt.com/ HTTP/1.1\r\nHost: chatgpt.com\r\n\r\n",
    );
    expect(rawResponse.startsWith("HTTP/1.1 400 Bad Request")).toBe(true);
    const nonTlsResponse = await proxyResponse(
      proxy,
      "CONNECT chatgpt.com:80 HTTP/1.1\r\nHost: chatgpt.com:80\r\n\r\n",
    );
    expect(nonTlsResponse.startsWith("HTTP/1.1 400 Bad Request")).toBe(true);
  });

  it("chains allowed provider CONNECT traffic through the configured upstream proxy", async () => {
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
      const proxy = await startNativeCliEgressProxy(["chatgpt.com"], {
        upstreamProxyUrl: `http://127.0.0.1:${address.port}`,
      });
      proxies.push(proxy);

      const response = await proxyConnectResponse(
        proxy,
        "CONNECT chatgpt.com:443 HTTP/1.1\r\nHost: chatgpt.com:443\r\n\r\n",
      );

      expect(response.startsWith("HTTP/1.1 200 Connection Established")).toBe(
        true,
      );
      expect(requests).toEqual(["CONNECT chatgpt.com:443 HTTP/1.1"]);
    } finally {
      await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
      await new Promise<void>((resolve, reject) => {
        upstream.close((error) => error === undefined ? resolve() : reject(error));
      });
    }
  });
});
