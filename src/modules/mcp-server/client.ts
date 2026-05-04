/**
 * MCP-server client contracts.
 *
 * The mcp-server module owns the `mcpServer` KotaClient namespace
 * end-to-end: the boot options, the discriminated start-result envelope,
 * and the `McpServerClient` interface itself. The aggregate `KotaClient`
 * interface in `src/core/server/kota-client.ts` composes this contract by
 * importing `McpServerClient` from this module instead of declaring the
 * shapes inline.
 *
 * Both the local-side handler (`localClient(ctx)` in `index.ts`) and the
 * daemon-side handler (`daemonClient(_link)` in `index.ts`) realize
 * `McpServerClient`; the `kota mcp-server` CLI consumes them through
 * `ctx.client.mcpServer`. The daemon-side handler is intentionally a
 * stub-only constant refusal: the underlying capability is a long-running
 * stdio MCP server in the operator's address space, which the daemon
 * cannot host on the operator's behalf.
 */

/**
 * Options accepted by `mcpServer.start`.
 *
 * `toolFilter` restricts which KOTA tools the MCP server exposes; absent /
 * empty means every registered tool. `name` is the server identity reported
 * to MCP clients and defaults to `"kota"`.
 */
export type McpServerStartOptions = {
  toolFilter?: string[];
  name: string;
};

/**
 * Result of `mcpServer.start`.
 *
 * Mirrors `WebStartResult`: the local handler runs a long-running stdio
 * server, while the daemon-side handler returns `daemon_required` because
 * the daemon cannot start a stdio server in another process.
 */
export type McpServerStartResult =
  | { ok: true }
  | { ok: false; reason: "daemon_required" };

export interface McpServerClient {
  start(options: McpServerStartOptions): Promise<McpServerStartResult>;
}
