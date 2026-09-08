import { IncomingMessage, type Server } from "node:http";
import { Socket } from "node:net";
import { PassThrough, Writable } from "node:stream";
import { vi } from "vitest";

// Replace socket I/O only. Production proxy authentication, request forwarding,
// target authorization, and lifecycle handlers still execute on real HTTP servers.
const { servers } = vi.hoisted(() => ({ servers: new Map<string, Server>() }));
let nextPort = 31000;

vi.mock("node:http", async (importOriginal) => {
  const http = await importOriginal<typeof import("node:http")>();
  return {
    ...http,
    createServer: (listener: Parameters<typeof http.createServer>[1]) => {
      const server = http.createServer(listener);
      const port = nextPort++;
      const address = `http://127.0.0.1:${port}`;
      vi.spyOn(server, "listen").mockImplementation((...args: unknown[]) => {
        servers.set(address, server);
        const callback = args.at(-1);
        if (typeof callback === "function") callback();
        return server;
      });
      vi.spyOn(server, "address").mockReturnValue({ port, family: "IPv4", address: "127.0.0.1" });
      vi.spyOn(server, "close").mockImplementation((callback) => {
        servers.delete(address);
        callback?.();
        return server;
      });
      return server;
    },
    request: (_url: URL, _options: unknown, callback: (response: IncomingMessage) => void) => {
      const request = new PassThrough();
      request.resume();
      queueMicrotask(() => {
        const response = new http.IncomingMessage(new Socket());
        response.statusCode = 200;
        response.statusMessage = "OK";
        callback(response);
        response.push("Private target response");
        response.push(null);
      });
      return request;
    },
  };
});

export type TestProxy = { server: string; username?: string; password?: string };

export async function requestThroughProxy(proxy: TestProxy, url: string): Promise<string> {
  const server = servers.get(proxy.server);
  if (!server) throw new Error("Browser proxy is closed");
  return new Promise((resolve, reject) => {
    const request = new IncomingMessage(new Socket());
    request.url = url;
    request.method = "GET";
    request.headers["proxy-authorization"] = `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`;
    const chunks: Buffer[] = [];
    class Response extends Writable {
      statusCode = 200;
      headersSent = false;
      writeHead(status: number) {
        this.statusCode = status;
        this.headersSent = true;
        return this;
      }
    }
    const response = new Response({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
      final(callback) {
        const body = Buffer.concat(chunks).toString();
        if (response.statusCode === 200) resolve(body);
        else reject(new Error(body));
        callback();
      },
    });
    server.emit("request", request, response);
    request.push(null);
  });
}
