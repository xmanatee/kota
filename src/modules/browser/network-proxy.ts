import type { LookupAddress } from "node:dns";
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type RequestOptions,
  type Server,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as connectTcp } from "node:net";
import type { Duplex } from "node:stream";
import {
  type OutboundHttpAddressResolver,
  type ResolvedOutboundAddress,
  resolveOutboundAddresses,
  resolveOutboundHttpConnectionAddress,
} from "#core/outbound-http/index.js";
import type { BrowserNetworkProfile } from "./config.js";
import {
  type BrowserProxyCredentials,
  browserProxyCredentialsMatch,
  createBrowserProxyCredentials,
} from "./network-proxy-auth.js";

export type BrowserNetworkProxy = {
  readonly server: string;
  readonly username: string;
  readonly password: string;
  close(): Promise<void>;
};

export type BrowserNetworkProxyOptions = {
  readonly profile: BrowserNetworkProfile;
  readonly resolveAddresses?: OutboundHttpAddressResolver;
};

export type BrowserProxyHttpConnection = {
  readonly url: URL;
  readonly address: ResolvedOutboundAddress;
};

export type BrowserProxyConnectConnection = BrowserProxyHttpConnection & {
  readonly port: number;
};

export async function startBrowserNetworkProxy(
  options: BrowserNetworkProxyOptions,
): Promise<BrowserNetworkProxy> {
  const credentials = createBrowserProxyCredentials();
  const resolveAddresses = options.resolveAddresses ?? resolveOutboundAddresses;
  const sockets = new Set<Duplex>();
  const server = createServer((request, response) => {
    if (!isAuthorized(request, credentials)) {
      rejectProxyAuthentication(response);
      return;
    }
    void forwardHttpRequest(
      request,
      response,
      options.profile,
      resolveAddresses,
    ).catch(() => rejectHttpRequest(response));
  });

  server.on("connect", (request, client, head) => {
    if (!isAuthorized(request, credentials)) {
      rejectConnectAuthentication(client);
      return;
    }
    void forwardConnectRequest(
      request,
      client,
      head,
      options.profile,
      resolveAddresses,
      sockets,
    ).catch(() => rejectConnectRequest(client));
  });
  server.on("connection", (socket) => trackSocket(socket, sockets));
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  await listenOnLoopback(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeProxyServer(server, sockets);
    throw new Error("browser network proxy did not bind a TCP address");
  }

  return {
    server: `http://127.0.0.1:${address.port}`,
    username: credentials.username,
    password: credentials.password,
    close: () => closeProxyServer(server, sockets),
  };
}

async function forwardHttpRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  profile: BrowserNetworkProfile,
  resolveAddresses: OutboundHttpAddressResolver,
): Promise<void> {
  const connection = await resolveBrowserProxyHttpConnection(
    incoming.url,
    profile,
    resolveAddresses,
  );
  const { address, url: target } = connection;
  const request = target.protocol === "https:" ? httpsRequest : httpRequest;
  const options: RequestOptions = {
    method: incoming.method,
    headers: forwardHeaders(incoming.headers),
    lookup: pinnedLookup(address),
  };

  await new Promise<void>((resolve, reject) => {
    const forwarded = request(target, options, (response) => {
      outgoing.writeHead(
        response.statusCode ?? 502,
        response.statusMessage,
        response.headers,
      );
      response.pipe(outgoing);
      response.once("end", resolve);
    });
    forwarded.once("error", reject);
    incoming.once("error", reject);
    incoming.pipe(forwarded);
  });
}

async function forwardConnectRequest(
  request: IncomingMessage,
  client: Duplex,
  head: Buffer,
  profile: BrowserNetworkProfile,
  resolveAddresses: OutboundHttpAddressResolver,
  sockets: Set<Duplex>,
): Promise<void> {
  const target = await resolveBrowserProxyConnectConnection(
    request.url,
    profile,
    resolveAddresses,
  );

  await new Promise<void>((resolve, reject) => {
    const upstream = connectTcp(
      {
        host: target.address.address,
        port: target.port,
        family: target.address.family,
      },
      () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
        resolve();
      },
    );
    trackSocket(upstream, sockets);
    upstream.once("error", reject);
  });
}

export async function resolveBrowserProxyHttpConnection(
  rawUrl: string | undefined,
  profile: BrowserNetworkProfile,
  resolveAddresses: OutboundHttpAddressResolver,
): Promise<BrowserProxyHttpConnection> {
  const url = parseAbsoluteProxyUrl(rawUrl);
  const address = await resolveOutboundHttpConnectionAddress(
    url,
    profile,
    resolveAddresses,
  );
  return { url, address };
}

export async function resolveBrowserProxyConnectConnection(
  rawTarget: string | undefined,
  profile: BrowserNetworkProfile,
  resolveAddresses: OutboundHttpAddressResolver,
): Promise<BrowserProxyConnectConnection> {
  const target = parseConnectTarget(rawTarget);
  const address = await resolveOutboundHttpConnectionAddress(
    target.url,
    profile,
    resolveAddresses,
  );
  return { ...target, address };
}

function parseAbsoluteProxyUrl(rawUrl: string | undefined): URL {
  if (!rawUrl) throw new Error("browser proxy request URL is missing");
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("browser proxy accepts only HTTP(S) requests");
  }
  return url;
}

function parseConnectTarget(rawTarget: string | undefined): {
  readonly url: URL;
  readonly port: number;
} {
  if (!rawTarget) throw new Error("browser proxy CONNECT target is missing");
  const url = new URL(`https://${rawTarget}/`);
  const port = url.port ? Number.parseInt(url.port, 10) : 443;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("browser proxy CONNECT port is invalid");
  }
  return { url, port };
}

function pinnedLookup(address: ResolvedOutboundAddress): NonNullable<RequestOptions["lookup"]> {
  return (_hostname, options, callback) => {
    if (typeof options === "object" && options.all === true) {
      callback(null, [address] as LookupAddress[]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

function forwardHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const forwarded = { ...headers };
  delete forwarded["proxy-authorization"];
  delete forwarded["proxy-connection"];
  return forwarded;
}

function isAuthorized(
  request: IncomingMessage,
  credentials: BrowserProxyCredentials,
): boolean {
  return browserProxyCredentialsMatch(
    request.headers["proxy-authorization"],
    credentials,
  );
}

function rejectProxyAuthentication(response: ServerResponse): void {
  response.writeHead(407, {
    "Proxy-Authenticate": 'Basic realm="kota-browser"',
    Connection: "close",
  });
  response.end("Proxy authentication required");
}

function rejectConnectAuthentication(socket: Duplex): void {
  socket.end(
    'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="kota-browser"\r\nConnection: close\r\n\r\n',
  );
}

function rejectHttpRequest(response: ServerResponse): void {
  if (response.destroyed) return;
  if (!response.headersSent) {
    response.writeHead(502, { Connection: "close" });
  }
  response.end("Browser network policy denied the request");
}

function rejectConnectRequest(socket: Duplex): void {
  if (socket.destroyed) return;
  socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
}

function trackSocket(socket: Duplex, sockets: Set<Duplex>): void {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
}

async function listenOnLoopback(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
}

async function closeProxyServer(
  server: Server,
  sockets: Set<Duplex>,
): Promise<void> {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
