#!/usr/bin/env node
/**
 * KOTA External Module Protocol demo — HTTP transport edition.
 *
 * Implements the KEMP HTTP transport: accepts POST requests containing a
 * single KEMP message as a JSON body and replies with the corresponding
 * inbound message as a JSON body.
 *
 * Usage:
 *   node examples/modules/kota-demo-http.js [port]
 *
 * Then configure in .kota/config.json:
 * {
 *   "foreignModules": [
 *     { "transport": "http", "url": "http://localhost:8765" }
 *   ]
 * }
 */

import { createServer } from "node:http";

const PORT = parseInt(process.argv[2] ?? "8765", 10);

const MANIFEST = {
  name: "kota-demo-http",
  version: "1.0.0",
  description: "Demo HTTP module for KOTA — provides two simple tools.",
  tools: [
    {
      name: "http_greet",
      description: "Returns a greeting message from the HTTP module.",
      input_schema: {
        type: "object",
        properties: { name: { type: "string", description: "Name to greet." } },
        required: ["name"],
      },
    },
    {
      name: "http_echo",
      description: "Echoes the input back as JSON.",
      input_schema: {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
    },
  ],
};

function handleMessage(msg) {
  if (msg.type === "init") {
    return { id: msg.id, type: "manifest", ...MANIFEST };
  }

  if (msg.type === "invoke") {
    if (msg.name === "http_greet") {
      const name = msg.input?.name ?? "World";
      return { id: msg.id, type: "result", content: `Hello, ${name}! (from Node.js HTTP module)` };
    }
    if (msg.name === "http_echo") {
      return { id: msg.id, type: "result", content: JSON.stringify(msg.input) };
    }
    return { id: msg.id, type: "result", content: `Unknown tool: ${msg.name}`, is_error: true };
  }

  if (msg.type === "shutdown") {
    // Reply with ack; the server keeps running (it may serve other KOTA instances).
    return { id: msg.id, type: "shutdown_ack" };
  }

  return { type: "error", message: `Unknown message type: ${msg.type}` };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }
  try {
    const body = await readBody(req);
    const msg = JSON.parse(body);
    const reply = handleMessage(msg);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply));
  } catch (err) {
    res.writeHead(400).end(String(err));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : PORT;
  process.stderr.write(`[kota-demo-http] Listening on http://127.0.0.1:${actualPort}\n`);
});
