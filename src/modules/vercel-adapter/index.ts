/**
 * Vercel adapter module — Vercel AI SDK Data Stream Protocol integration.
 *
 * Extracts the Vercel AI SDK chat handling from server.ts into a KotaModule,
 * continuing the module-first architecture plan. Registers a dedicated HTTP route
 * for Vercel AI SDK formatted requests at POST /api/chat/vercel.
 *
 * Each request is stateless — a fresh AgentSession is created per request,
 * which aligns with the Vercel AI SDK's `useChat` pattern where the client
 * sends the full messages array on every request.
 */

import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import { AgentSession } from "#core/loop/loop.js";
import type { KotaModule } from "#core/modules/module-types.js";
import { CORS_HEADERS, jsonResponse, readBody, setCors } from "#core/server/session-pool.js";
import { AUTONOMY_MODES, type AutonomyMode } from "#core/tools/autonomy-mode.js";
import {
  DATA_STREAM_HEADERS,
  DataStreamTransport,
  extractLastUserMessage,
} from "./data-stream.js";

type VercelAdapterConfig = {
  /** Autonomy mode applied to Vercel AI SDK chat sessions. */
  defaultAutonomyMode?: AutonomyMode;
};

const vercelAdapterModule: KotaModule = {
  name: "vercel-adapter",
  version: "1.0.0",
  description: "Vercel AI SDK Data Stream Protocol integration for HTTP chat",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      defaultAutonomyMode: { type: "string", enum: AUTONOMY_MODES },
    },
  },

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

        const adapterConfig = ctx.getModuleConfig<VercelAdapterConfig>();
        let autonomyMode: AutonomyMode;
        try {
          autonomyMode = resolveChannelAutonomyMode(
            adapterConfig?.defaultAutonomyMode,
            ctx.config,
            "vercel-adapter",
          );
        } catch (err) {
          jsonResponse(res, 400, { error: (err as Error).message });
          return;
        }

        setCors(res);
        res.writeHead(200, { ...DATA_STREAM_HEADERS, ...CORS_HEADERS });

        const stream = new DataStreamTransport(res);
        const agent = new AgentSession({
          autonomyMode,
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
