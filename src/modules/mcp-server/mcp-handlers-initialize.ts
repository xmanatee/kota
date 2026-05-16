/**
 * MCP `initialize` handshake plus workspace-roots state owned by the same
 * lifecycle: capability negotiation, the deferred outbound `roots/list`
 * request, the `notifications/roots/list_changed` re-fetch, and the typed
 * accessors the rest of the server uses to resolve the effective project
 * directory.
 */

import type {
	HandlerContext,
	JsonRpcRequest,
	JsonRpcResponse,
	McpRoot,
} from "./mcp-protocol-types.js";
import {
	MCP_DRAFT_PROTOCOL_VERSION,
	MCP_LEGACY_PROTOCOL_VERSION,
	type McpProtocolVersion,
} from "./mcp-protocol-types.js";

export type InitializeOptions = {
	serverName: string;
	serverVersion: string;
	projectDir: string;
	advertiseSampling: () => boolean;
};

/**
 * Decode a JSON-RPC `roots/list` response payload. Malformed entries
 * (missing `uri`, non-string fields) are dropped — the spec treats the
 * server as best-effort here, and silently skipping a bad entry is less
 * disruptive than rejecting the whole response.
 */
function decodeRootsListResult(result: unknown): McpRoot[] {
	if (!result || typeof result !== "object") return [];
	const rawRoots = (result as { roots?: unknown }).roots;
	if (!Array.isArray(rawRoots)) return [];
	const out: McpRoot[] = [];
	for (const raw of rawRoots) {
		if (!raw || typeof raw !== "object") continue;
		const r = raw as { uri?: unknown; name?: unknown };
		if (typeof r.uri !== "string") continue;
		const root: McpRoot = { uri: r.uri };
		if (typeof r.name === "string") root.name = r.name;
		out.push(root);
	}
	return out;
}

function negotiateInitializeProtocolVersion(requested: string): McpProtocolVersion | null {
	if (requested === MCP_DRAFT_PROTOCOL_VERSION) return MCP_DRAFT_PROTOCOL_VERSION;
	if (requested === MCP_LEGACY_PROTOCOL_VERSION) return MCP_LEGACY_PROTOCOL_VERSION;
	return null;
}

export class InitializeHandler {
	private clientRoots: McpRoot[] = [];
	private pendingRootsRequest: {
		id: number | string;
		resolve: (roots: McpRoot[]) => void;
		reject: (e: Error) => void;
	} | null = null;
	private rootsRequestIdCounter = 0;

	constructor(
		private readonly ctx: HandlerContext,
		private readonly options: InitializeOptions,
	) {}

	handleInitialize(msg: JsonRpcRequest): void {
		const requestedProtocolVersion =
			typeof msg.params?.protocolVersion === "string"
				? msg.params.protocolVersion
				: MCP_LEGACY_PROTOCOL_VERSION;
		const negotiatedProtocolVersion =
			negotiateInitializeProtocolVersion(requestedProtocolVersion);
		if (!negotiatedProtocolVersion) {
			this.ctx.transport.sendError(msg, -32602, "Unsupported protocol version");
			return;
		}
		this.ctx.session.protocolVersion = negotiatedProtocolVersion;
		this.ctx.session.initialized = true;
		const clientCaps = (msg.params?.capabilities ?? {}) as Record<string, unknown>;
		this.ctx.session.clientSupportsElicitation =
			typeof clientCaps.elicitation === "object" && clientCaps.elicitation !== null;
		this.ctx.session.clientSupportsRoots =
			typeof clientCaps.roots === "object" && clientCaps.roots !== null;

		const capabilities: Record<string, unknown> = {
			tools: {},
			resources: { subscribe: true },
			prompts: {},
			completions: {},
			roots: {},
		};
		if (this.ctx.session.clientSupportsElicitation) {
			capabilities.elicitation = {};
		}
		if (this.options.advertiseSampling()) {
			capabilities.sampling = {};
		}
		this.ctx.transport.sendResult(msg, {
			protocolVersion: this.ctx.session.protocolVersion,
			capabilities,
			serverInfo: {
				name: this.options.serverName,
				version: this.options.serverVersion,
			},
		});
		this.ctx.log(
			`Initialized successfully (elicitation: ${this.ctx.session.clientSupportsElicitation}, sampling: ${this.options.advertiseSampling()}, completions: true, roots: ${this.ctx.session.clientSupportsRoots})`,
		);
		if (this.ctx.session.clientSupportsRoots) {
			// Defer so the initialize response is fully consumed by the client before
			// we send the roots/list request — avoids dropped writes on synchronous streams.
			setImmediate(() => {
				this.fetchClientRoots().catch((err) => {
					this.ctx.log(
						`Failed to fetch client roots: ${err instanceof Error ? err.message : String(err)}`,
					);
				});
			});
		}
	}

	handleRootsListChangedNotification(): void {
		if (!this.ctx.session.clientSupportsRoots) return;
		setImmediate(() => {
			this.fetchClientRoots().catch((err) => {
				this.ctx.log(
					`Failed to refresh client roots: ${err instanceof Error ? err.message : String(err)}`,
				);
			});
		});
	}

	tryConsumeResponse(msg: JsonRpcResponse): boolean {
		if (!this.pendingRootsRequest || msg.id !== this.pendingRootsRequest.id) {
			return false;
		}
		const pending = this.pendingRootsRequest;
		this.pendingRootsRequest = null;
		if (msg.error) {
			pending.reject(new Error(msg.error.message));
			return true;
		}
		pending.resolve(decodeRootsListResult(msg.result));
		return true;
	}

	/** Returns the client-provided workspace roots, or an empty array if none. */
	getClientRoots(): McpRoot[] {
		return [...this.clientRoots];
	}

	/**
	 * Returns the effective project directory: the first client root's file
	 * path when roots are provided, otherwise the configured projectDir.
	 */
	getEffectiveProjectDir(): string {
		if (this.clientRoots.length > 0) {
			const firstUri = this.clientRoots[0].uri;
			if (firstUri.startsWith("file://")) {
				try {
					return new URL(firstUri).pathname;
				} catch {
					// Fall through to default
				}
			}
		}
		return this.options.projectDir;
	}

	private async fetchClientRoots(): Promise<void> {
		const id = `roots-${++this.rootsRequestIdCounter}`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingRootsRequest = null;
				reject(new Error("roots/list request timed out"));
			}, 10_000);
			this.pendingRootsRequest = {
				id,
				resolve: (roots) => {
					clearTimeout(timer);
					this.clientRoots = roots;
					resolve();
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			};
			this.ctx.transport.send({
				jsonrpc: "2.0",
				id,
				method: "roots/list",
				params: {},
			});
		});
	}
}
