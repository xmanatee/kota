import { createConnection, type Socket } from "node:net";

export const NATIVE_CLI_CONNECT_HEADER_LIMIT = 16 * 1024;
export const NATIVE_CLI_CONNECT_TIMEOUT_MS = 10_000;

export type NativeCliProviderTarget = {
  host: string;
  port: 443;
};

export type NativeCliProviderConnection = {
  socket: Socket;
  pending: Buffer;
};

export type NativeCliUpstreamProxyTarget = {
  host: string;
  port: number;
};

export function parseNativeCliUpstreamProxyUrl(
  proxyUrl: string,
): NativeCliUpstreamProxyTarget {
  let parsed: URL;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    throw new Error("native CLI upstream proxy URL must be absolute");
  }
  if (parsed.protocol !== "http:") {
    throw new Error("native CLI upstream proxy URL must use http://");
  }
  if (
    parsed.hostname.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error(
      "native CLI upstream proxy URL must contain only a host and optional port",
    );
  }
  const port = parsed.port === "" ? 80 : Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("native CLI upstream proxy URL has an invalid port");
  }
  const host = parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
    ? parsed.hostname.slice(1, -1)
    : parsed.hostname;
  return { host, port };
}

export async function connectNativeCliProviderThroughProxy(
  target: NativeCliProviderTarget,
  proxy: NativeCliUpstreamProxyTarget,
): Promise<NativeCliProviderConnection> {
  return await new Promise<NativeCliProviderConnection>((resolve, reject) => {
    const socket = createConnection({ host: proxy.host, port: proxy.port });
    let response = Buffer.alloc(0);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`upstream proxy connection to ${proxy.host} timed out`));
    }, NATIVE_CLI_CONNECT_TIMEOUT_MS);
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      reject(error);
    };
    socket.once("connect", () => {
      const authority = `${target.host}:${target.port}`;
      socket.write(
        `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n` +
          "Proxy-Connection: Keep-Alive\r\n\r\n",
      );
    });
    socket.on("data", (chunk: Buffer) => {
      if (settled) return;
      response = Buffer.concat([response, chunk]);
      if (response.length > NATIVE_CLI_CONNECT_HEADER_LIMIT) {
        fail(new Error("upstream proxy response headers exceeded the limit"));
        return;
      }
      const headerEnd = response.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const statusLine = response
        .subarray(0, headerEnd)
        .toString("ascii")
        .split("\r\n")[0];
      if (
        statusLine === undefined ||
        !/^HTTP\/1\.[01] 200(?: |$)/.test(statusLine)
      ) {
        fail(
          new Error(
            `upstream proxy rejected provider CONNECT: ${statusLine ?? "missing status"}`,
          ),
        );
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.pause();
      resolve({ socket, pending: response.subarray(headerEnd + 4) });
    });
    socket.once("error", (error) => fail(error));
    socket.once("end", () =>
      fail(new Error("upstream proxy closed before establishing CONNECT")));
  });
}
