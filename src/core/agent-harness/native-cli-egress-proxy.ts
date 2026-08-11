import { createConnection, createServer, type Server, type Socket } from "node:net";
import {
  resolveOutboundAddresses,
  resolvePublicOutboundAddresses,
} from "#core/outbound-http/network-policy.js";
import {
  connectNativeCliProviderThroughProxy,
  NATIVE_CLI_CONNECT_HEADER_LIMIT,
  NATIVE_CLI_CONNECT_TIMEOUT_MS,
  type NativeCliProviderConnection,
  type NativeCliProviderTarget,
  type NativeCliUpstreamProxyTarget,
  parseNativeCliUpstreamProxyUrl,
} from "./native-cli-egress-upstream.js";

export const NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV =
  "KOTA_NATIVE_CLI_EGRESS_UPSTREAM_PROXY";

export type NativeCliEgressProxyAddress =
  | { kind: "tcp"; host: "127.0.0.1"; port: number }
  | { kind: "unix"; path: string };

export type NativeCliEgressProxy = {
  address: NativeCliEgressProxyAddress;
  close: () => Promise<void>;
};

type NativeCliEgressProxyOptions = {
  unixSocketPath?: string;
  upstreamProxyUrl?: string;
};

function parseConnectTarget(
  requestLine: string,
): NativeCliProviderTarget | undefined {
  const match = /^CONNECT ([^ ]+) HTTP\/1\.[01]$/.exec(requestLine);
  if (match === null) return undefined;
  const authority = match[1]!;
  const separator = authority.lastIndexOf(":");
  if (separator <= 0 || authority.slice(separator + 1) !== "443") {
    return undefined;
  }
  const host = authority.slice(0, separator).toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(host)) return undefined;
  return { host, port: 443 };
}

function writeProxyError(socket: Socket, status: 400 | 403 | 502): void {
  const reason = status === 400
    ? "Bad Request"
    : status === 403
      ? "Forbidden"
      : "Bad Gateway";
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
}

async function connectPublicProvider(
  target: NativeCliProviderTarget,
): Promise<NativeCliProviderConnection> {
  const addresses = await resolvePublicOutboundAddresses(
    target.host,
    resolveOutboundAddresses,
  );
  let lastError: Error | undefined;
  for (const address of addresses) {
    try {
      const socket = await new Promise<Socket>((resolve, reject) => {
        const socket = createConnection({
          host: address.address,
          port: target.port,
          family: address.family,
        });
        const timeout = setTimeout(() => {
          socket.destroy();
          reject(new Error(`provider connection to ${target.host} timed out`));
        }, NATIVE_CLI_CONNECT_TIMEOUT_MS);
        socket.once("connect", () => {
          clearTimeout(timeout);
          resolve(socket);
        });
        socket.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      return { socket, pending: Buffer.alloc(0) };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error(`provider ${target.host} has no reachable address`);
}

function connectProvider(
  target: NativeCliProviderTarget,
  upstreamProxy: NativeCliUpstreamProxyTarget | undefined,
): Promise<NativeCliProviderConnection> {
  return upstreamProxy === undefined
    ? connectPublicProvider(target)
    : connectNativeCliProviderThroughProxy(target, upstreamProxy);
}

function handleProxyClient(
  client: Socket,
  allowedHosts: ReadonlySet<string>,
  sockets: Set<Socket>,
  upstreamProxy: NativeCliUpstreamProxyTarget | undefined,
): void {
  sockets.add(client);
  client.once("close", () => sockets.delete(client));
  let request = Buffer.alloc(0);

  const onData = async (chunk: Buffer): Promise<void> => {
    request = Buffer.concat([request, chunk]);
    if (request.length > NATIVE_CLI_CONNECT_HEADER_LIMIT) {
      client.off("data", onData);
      writeProxyError(client, 400);
      return;
    }
    const headerEnd = request.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    client.off("data", onData);
    client.pause();

    const requestLine = request.subarray(0, headerEnd).toString("ascii").split("\r\n")[0];
    const target = requestLine === undefined
      ? undefined
      : parseConnectTarget(requestLine);
    if (target === undefined) {
      writeProxyError(client, 400);
      return;
    }
    if (!allowedHosts.has(target.host)) {
      writeProxyError(client, 403);
      return;
    }

    try {
      const connection = await connectProvider(target, upstreamProxy);
      const upstream = connection.socket;
      sockets.add(upstream);
      upstream.once("close", () => sockets.delete(upstream));
      upstream.once("error", () => client.destroy());
      client.once("error", () => upstream.destroy());
      const pending = request.subarray(headerEnd + 4);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (connection.pending.length > 0) client.write(connection.pending);
      if (pending.length > 0) upstream.write(pending);
      client.pipe(upstream).pipe(client);
      client.resume();
    } catch {
      writeProxyError(client, 502);
    }
  };

  client.on("data", onData);
  client.once("error", () => client.destroy());
}

async function listen(server: Server, address: NativeCliEgressProxyAddress): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      resolve();
    });
    if (address.kind === "unix") server.listen(address.path);
    else server.listen(0, address.host);
  });
}

/**
 * Terminates native CLI HTTP CONNECT traffic at a host-owned allowlist. The
 * OS sandbox permits only this proxy, so native tools cannot bypass it by
 * clearing proxy variables or opening raw sockets. When an upstream proxy is
 * supplied, allowed CONNECT requests are chained through it instead of opening
 * a direct provider connection.
 */
export async function startNativeCliEgressProxy(
  allowedHosts: readonly string[],
  options: NativeCliEgressProxyOptions = {},
): Promise<NativeCliEgressProxy> {
  const normalizedHosts = new Set(
    allowedHosts.map((host) => host.toLowerCase().replace(/\.$/, "")),
  );
  if (normalizedHosts.size === 0) {
    throw new Error("native CLI provider egress requires at least one allowed host");
  }
  const upstreamProxy = options.upstreamProxyUrl === undefined
    ? undefined
    : parseNativeCliUpstreamProxyUrl(options.upstreamProxyUrl);
  const sockets = new Set<Socket>();
  const server = createServer((client) =>
    handleProxyClient(client, normalizedHosts, sockets, upstreamProxy));
  const requestedAddress: NativeCliEgressProxyAddress =
    options.unixSocketPath === undefined
    ? { kind: "tcp", host: "127.0.0.1", port: 0 }
    : { kind: "unix", path: options.unixSocketPath };
  await listen(server, requestedAddress);
  const bound = server.address();
  const address: NativeCliEgressProxyAddress = typeof bound === "string"
    ? { kind: "unix", path: bound }
    : bound === null
      ? (() => {
          throw new Error("native CLI provider egress proxy did not bind");
        })()
      : { kind: "tcp", host: "127.0.0.1", port: bound.port };

  return {
    address,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    },
  };
}
