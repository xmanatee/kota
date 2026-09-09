import type { IncomingMessage, ServerResponse } from "node:http";

type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

/** Hosts own matching and authorization; all awaited route work shares this boundary. */
export function withRouteErrorBoundary(handler: HttpHandler): HttpHandler {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (res.headersSent || res.writableEnded || res.destroyed) return;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  };
}
