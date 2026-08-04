import { createConnection } from "node:net";
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
});
