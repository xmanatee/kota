import { afterEach, describe, expect, it, vi } from "vitest";
import { MCP_CURRENT_PROTOCOL_VERSION, type McpCatalogOptions, McpClient } from "./client.js";
import {
  jsonRpcHttpResponse,
  mockClientHttpFetch,
  type RecordedClientHttpRequest,
} from "./client-http-test-helpers.js";
import {
  MCP_CATALOG_MAX_BYTES,
  MCP_CATALOG_MAX_ENTRIES,
  MCP_CATALOG_MAX_PAGES,
  MCP_CATALOG_TIMEOUT_MS,
} from "./client-operations.js";

const catalogs = [
  {
    method: "tools/list", key: "tools",
    entry: { name: "tool", inputSchema: { type: "object" } },
    list: async (client: McpClient, options?: McpCatalogOptions) => ({ entries: await client.listTools(options) }),
  },
  {
    method: "resources/list", key: "resources",
    entry: { name: "resource", uri: "file:///resource" },
    list: async (client: McpClient, options?: McpCatalogOptions) => {
      const page = await client.listResources(options);
      return { entries: page.resources, cache: page.cache };
    },
  },
  {
    method: "resources/templates/list", key: "resourceTemplates",
    entry: { name: "template", uriTemplate: "file:///{name}" },
    list: async (client: McpClient, options?: McpCatalogOptions) => {
      const page = await client.listResourceTemplates(options);
      return { entries: page.resourceTemplates, cache: page.cache };
    },
  },
  {
    method: "prompts/list", key: "prompts",
    entry: { name: "prompt" },
    list: async (client: McpClient, options?: McpCatalogOptions) => {
      const page = await client.listPrompts(options);
      return { entries: page.prompts, cache: page.cache };
    },
  },
];

describe.each(catalogs)("MCP bounded $method catalog", (catalog) => {
  let client: McpClient;
  let restoreFetch: () => void;

  afterEach(async () => {
    await client?.close();
    restoreFetch?.();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function connect(handler: (request: RecordedClientHttpRequest) => Response) {
    const http = mockClientHttpFetch((req) => req.body.method === "server/discover"
      ? jsonRpcHttpResponse(req.body.id, {
        supportedVersions: [MCP_CURRENT_PROTOCOL_VERSION],
        capabilities: { tools: {}, resources: {}, prompts: {} },
      })
      : handler(req));
    restoreFetch = http.mockRestore;
    client = new McpClient({ type: "http", url: "https://mcp.example.test/mcp" }, "catalog-peer");
    await client.connect();
    return http;
  }

  it("stops a continuously unique cursor peer, including empty pages, and permits a fresh traversal", async () => {
    let pages = 0;
    let continuing = true;
    await connect((req) => jsonRpcHttpResponse(req.body.id, {
      [catalog.key]: ++pages % 2 ? [catalog.entry] : [],
      ...(continuing ? { nextCursor: `cursor-${pages}` } : {}),
    }));
    await expect(catalog.list(client)).rejects.toThrow(/catalog traversal .*pages limit/);
    expect(pages).toBe(MCP_CATALOG_MAX_PAGES);
    continuing = false;
    await expect(catalog.list(client)).resolves.toMatchObject({ entries: [catalog.entry] });
  });

  it("accepts a complete catalog at the page limit with conservative cache hints", async () => {
    let pages = 0;
    await connect((req) => {
      pages++;
      return jsonRpcHttpResponse(req.body.id, {
        [catalog.key]: [catalog.entry],
        ...(pages < MCP_CATALOG_MAX_PAGES ? { nextCursor: String(pages) } : {}),
        ttlMs: pages === 1 ? 1000 : 2000,
        cacheScope: pages === 1 ? "private" : "public",
      });
    });
    const result = await catalog.list(client);
    expect(result.entries).toHaveLength(MCP_CATALOG_MAX_PAGES);
    if ("cache" in result) expect(result.cache).toEqual({ ttlMs: 1000, cacheScope: "private" });
  });

  it("rejects aggregate entry overflow even when each page fits the response limit", async () => {
    let pages = 0;
    let overflow = false;
    await connect((req) => {
      const second = req.body.params?.cursor !== undefined;
      pages++;
      return jsonRpcHttpResponse(req.body.id, {
        [catalog.key]: Array.from({ length: MCP_CATALOG_MAX_ENTRIES / 2 + (second && overflow ? 1 : 0) }, () => catalog.entry),
        ...(!second ? { nextCursor: "second" } : {}),
      });
    });
    expect((await catalog.list(client)).entries).toHaveLength(MCP_CATALOG_MAX_ENTRIES);
    overflow = true;
    await expect(catalog.list(client)).rejects.toThrow(/catalog traversal .*entries limit/);
    expect(pages).toBe(4);
  });

  it("counts UTF-8 cursor bytes across individually bounded responses", async () => {
    let pages = 0;
    const cursor = "é".repeat(256 * 1024);
    await connect((req) => jsonRpcHttpResponse(req.body.id, {
      [catalog.key]: [], nextCursor: `${++pages}-${cursor}`,
    }));
    await expect(catalog.list(client)).rejects.toThrow(/catalog traversal .*aggregate bytes limit/);
    expect(pages).toBe(Math.ceil(MCP_CATALOG_MAX_BYTES / Buffer.byteLength(cursor)));
  });

  it("still rejects repeated cursors", async () => {
    let pages = 0;
    await connect((req) => {
      pages++;
      return jsonRpcHttpResponse(req.body.id, { [catalog.key]: [], nextCursor: "repeat" });
    });
    await expect(catalog.list(client)).rejects.toThrow(/repeated nextCursor/);
    expect(pages).toBe(2);
  });

  it("rejects pre-cancellation without requesting a page", async () => {
    let pages = 0;
    await connect((req) => {
      pages++;
      return jsonRpcHttpResponse(req.body.id, { [catalog.key]: [] });
    });
    const controller = new AbortController();
    controller.abort(new Error("owner cancelled catalog"));
    await expect(catalog.list(client, { signal: controller.signal })).rejects.toThrow("owner cancelled catalog");
    expect(pages).toBe(0);
  });

  it.each(["deadline", "cancellation"])("aborts an in-flight response on whole-traversal %s", async (reason) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const signals: AbortSignal[] = [];
    await connect((req) => {
      const signal = req.signal!;
      signals.push(signal);
      const body = JSON.stringify({ jsonrpc: "2.0", id: req.body.id, result: {
        [catalog.key]: [catalog.entry], nextCursor: String(signals.length),
      } });
      return new Response(new ReadableStream({
        start(controller) {
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            controller.enqueue(new TextEncoder().encode(body));
            controller.close();
          }, 8000);
          const onAbort = () => {
            clearTimeout(timer);
            controller.error(signal.reason);
          };
          signal.addEventListener("abort", onAbort, { once: true });
        },
      }), { headers: { "content-type": "application/json" } });
    });
    const controller = new AbortController();
    const pending = catalog.list(client, { signal: controller.signal });
    const assertion = expect(pending).rejects.toThrow(reason === "deadline" ? /deadline/ : /owner cancelled catalog/);
    if (reason === "deadline") {
      await vi.advanceTimersByTimeAsync(MCP_CATALOG_TIMEOUT_MS);
      expect(signals).toHaveLength(4);
    } else {
      await vi.advanceTimersByTimeAsync(8001);
      controller.abort(new Error("owner cancelled catalog"));
      expect(signals).toHaveLength(2);
    }
    await assertion;
    expect(signals.at(-1)?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("MCP catalog cancellation and publication", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ignores a late stdio response after cancellation and completes a fresh catalog", async () => {
    const peer = `
      const readline = require('node:readline');
      let lists = 0;
      const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
      readline.createInterface({ input: process.stdin }).on('line', (line) => {
        const request = JSON.parse(line);
        if (request.method === 'initialize') send(request.id, {
          protocolVersion: '2024-11-05', capabilities: { resources: {} },
          serverInfo: { name: 'catalog-peer', version: '1' },
        });
        if (request.method === 'resources/list') {
          const name = ++lists === 1 ? 'cancelled' : 'fresh';
          setTimeout(() => send(request.id, { resources: [{ name, uri: 'file:///' + name }] }), lists * 20);
        }
      });
    `;
    const client = new McpClient(process.execPath, ["-e", peer]);
    try {
      await client.connect();
      const controller = new AbortController();
      const pending = client.listResources({ signal: controller.signal });
      controller.abort(new Error("owner cancelled catalog"));
      await expect(pending).rejects.toThrow("owner cancelled catalog");
      expect((await client.listResources()).resources).toEqual([{ name: "fresh", uri: "file:///fresh" }]);
    } finally {
      await client.close();
    }
  });

  it("does not replace tool header parameters with a failed partial catalog", async () => {
    let excessive = false;
    let pages = 0;
    const http = mockClientHttpFetch((req) => {
      if (req.body.method === "server/discover") return jsonRpcHttpResponse(req.body.id, {
        supportedVersions: [MCP_CURRENT_PROTOCOL_VERSION], capabilities: { tools: {} },
      });
      if (req.body.method === "tools/list") return jsonRpcHttpResponse(req.body.id, {
        tools: [{ name: "tool", inputSchema: { type: "object", properties: {
          token: { type: "string", "x-mcp-header": excessive ? "changed" : "original" },
        } } }],
        ...(excessive ? { nextCursor: String(++pages) } : {}),
      });
      return jsonRpcHttpResponse(req.body.id, { content: [] });
    });
    const client = new McpClient({ type: "http", url: "https://mcp.example.test/mcp" });
    try {
      await client.connect();
      await client.listTools();
      excessive = true;
      await expect(client.listTools()).rejects.toThrow(/pages limit/);
      await client.callTool("tool", { token: "example" });
      const headers = http.requests.at(-1)?.headers;
      expect(headers?.get("mcp-param-original")).toBe("example");
      expect(headers?.has("mcp-param-changed")).toBe(false);
    } finally {
      await client.close();
      http.mockRestore();
    }
  });

  it("enforces elapsed time even before the deadline timer can run", async () => {
    let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    const http = mockClientHttpFetch((req) => {
      if (req.body.method === "server/discover") return jsonRpcHttpResponse(req.body.id, {
        supportedVersions: [MCP_CURRENT_PROTOCOL_VERSION], capabilities: { resources: {} },
      });
      elapsed = MCP_CATALOG_TIMEOUT_MS;
      return jsonRpcHttpResponse(req.body.id, { resources: [], nextCursor: "next" });
    });
    const client = new McpClient({ type: "http", url: "https://mcp.example.test/mcp" });
    try {
      await client.connect();
      await expect(client.listResources()).rejects.toThrow(/deadline/);
      expect(http.requests.filter((req) => req.body.method === "resources/list")).toHaveLength(1);
    } finally {
      await client.close();
      http.mockRestore();
    }
  });
});
