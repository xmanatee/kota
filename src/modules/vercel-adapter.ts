/**
 * Vercel adapter module — Vercel AI SDK Data Stream Protocol integration.
 *
 * Extracts the Vercel AI SDK chat handling from server.ts into a KotaModule,
 * completing the modular architecture plan. Registers a dedicated HTTP route
 * for Vercel AI SDK formatted requests at POST /api/chat/vercel.
 *
 * Each request is stateless — a fresh AgentSession is created per request,
 * which aligns with the Vercel AI SDK's `useChat` pattern where the client
 * sends the full messages array on every request.
 */

import type { KotaModule } from "../module-types.js";
import { AgentSession } from "../loop.js";
import { CORS_HEADERS, jsonResponse, readBody, setCors } from "../session-pool.js";
import {
  DATA_STREAM_HEADERS,
  DataStreamTransport,
  extractLastUserMessage,
} from "../vercel-ai-stream.js";

const vercelAdapterModule: KotaModule = {
  name: "vercel-adapter",
  version: "1.0.0",
  description: "Vercel AI SDK Data Stream Protocol integration for HTTP chat",

  routes: (ctx) => [
    {
      method: "POST",
      path: "/api/chat/vercel",
      handler: async (req, res) => {
        let body: Record<string, unknown>;
        try {
          body = await readBody(req);
        } catch (err) {
          jsonResponse(res, 400, { error: (err as Error).message });
          return;
        }

        const messages = body.messages;
        if (!Array.isArray(messages)) {
          jsonResponse(res, 400, {
            error: "Expected messages array (Vercel AI SDK format)",
          });
          return;
        }

        const message = extractLastUserMessage(
          messages as Array<{ role: string; content: string }>,
        );
        if (!message) {
          jsonResponse(res, 400, {
            error: "No user message found in messages array",
          });
          return;
        }

        setCors(res);
        res.writeHead(200, { ...DATA_STREAM_HEADERS, ...CORS_HEADERS });

        const stream = new DataStreamTransport(res);
        const agent = new AgentSession({
          model: (body.model as string) || ctx.config.model,
          verbose: ctx.verbose,
          transport: stream,
          config: ctx.config,
        });

        try {
          await agent.send(message);
          stream.finish();
        } catch (err) {
          stream.emit({ type: "error", message: (err as Error).message });
          stream.finish();
        }
      },
    },
  ],
};

export default vercelAdapterModule;
