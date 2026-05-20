/**
 * MCP `initialize` handshake plus the legacy workspace-roots compatibility
 * branch. Draft roots are requested through MRTR on the originating request
 * instead of through standalone server-initiated JSON-RPC calls.
 */

import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type {
	HandlerContext,
	JsonRpcRequest,
	JsonRpcResponse,
	McpClientCapabilities,
	McpRoot,
} from "./mcp-protocol-types.js";
import {
	decodeClientElicitationCapabilities,
	MCP_DRAFT_PROTOCOL_VERSION,
	MCP_LEGACY_PROTOCOL_VERSION,
	MCP_SUPPORTED_PROTOCOL_VERSIONS,
	type McpProtocolVersion,
} from "./mcp-protocol-types.js";

export type InitializeOptions = {
	serverName: string;
	serverVersion: string;
	projectDir: string;
	advertiseSampling: () => boolean;
};

function isJsonObject(value: JsonRpcResponse["result"]): value is KotaJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Decode a JSON-RPC `roots/list` response payload. Malformed entries
 * (missing `uri`, non-string fields) are dropped — the spec treats the
 * server as best-effort here, and silently skipping a bad entry is less
 * disruptive than rejecting the whole response.
 */
function decodeRootsListResult(result: JsonRpcResponse["result"]): McpRoot[] {
	if (!isJsonObject(result)) return [];
	const rawRoots = result.roots;
	if (!Array.isArray(rawRoots)) return [];
	const out: McpRoot[] = [];
	for (const raw of rawRoots) {
		if (!isJsonObject(raw)) continue;
		if (typeof raw.uri !== "string") continue;
		const root: McpRoot = { uri: raw.uri };
		if (typeof raw.name === "string") root.name = raw.name;
		out.push(root);
	}
	return out;
}

function negotiateInitializeProtocolVersion(requested: string): McpProtocolVersion | null {
	if (requested === MCP_DRAFT_PROTOCOL_VERSION) return MCP_DRAFT_PROTOCOL_VERSION;
	if (requested === MCP_LEGACY_PROTOCOL_VERSION) return MCP_LEGACY_PROTOCOL_VERSION;
	return null;
}

function buildDraftServerCapabilities(): KotaJsonObject {
	return {
		tools: {},
		resources: { listChanged: true },
		prompts: { listChanged: true },
		completions: {},
	};
}

function buildLegacyServerCapabilities(args: {
	clientSupportsFormElicitation: boolean;
	advertiseSampling: boolean;
}): KotaJsonObject {
	const capabilities: KotaJsonObject = {
		tools: {},
		resources: { subscribe: true },
		prompts: {},
		completions: {},
		roots: {},
	};
	if (args.clientSupportsFormElicitation) {
		capabilities.elicitation = {};
	}
	if (args.advertiseSampling) {
		capabilities.sampling = {};
	}
	return capabilities;
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
			this.ctx.transport.sendError(msg, -32602, "Unsupported protocol version", {
				supportedVersions: [...MCP_SUPPORTED_PROTOCOL_VERSIONS],
				requestedVersion: requestedProtocolVersion,
			});
			return;
		}
		this.ctx.session.protocolVersion = negotiatedProtocolVersion;
		this.ctx.session.initialized = true;
		const clientCaps = (msg.params?.capabilities ?? {}) as McpClientCapabilities;
		this.ctx.session.clientElicitation = decodeClientElicitationCapabilities(clientCaps);
		this.ctx.session.clientSupportsRoots =
			typeof clientCaps.roots === "object" && clientCaps.roots !== null;

		const capabilities =
			this.ctx.session.protocolVersion === MCP_DRAFT_PROTOCOL_VERSION
				? buildDraftServerCapabilities()
				: buildLegacyServerCapabilities({
					clientSupportsFormElicitation: this.ctx.session.clientElicitation.form,
					advertiseSampling: this.options.advertiseSampling(),
				});
		this.ctx.transport.sendResult(msg, {
			protocolVersion: this.ctx.session.protocolVersion,
			capabilities,
			serverInfo: {
				name: this.options.serverName,
				version: this.options.serverVersion,
			},
		});
		this.ctx.log(
			`Initialized successfully (elicitation.form: ${this.ctx.session.clientElicitation.form}, elicitation.url: ${this.ctx.session.clientElicitation.url}, sampling: ${this.options.advertiseSampling()}, completions: true, roots: ${this.ctx.session.clientSupportsRoots})`,
		);
		if (
			this.ctx.session.protocolVersion === MCP_LEGACY_PROTOCOL_VERSION &&
			this.ctx.session.clientSupportsRoots
		) {
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

	handleDiscover(msg: JsonRpcRequest): void {
		this.ctx.transport.sendResult(msg, {
			supportedVersions: [...MCP_SUPPORTED_PROTOCOL_VERSIONS],
			capabilities: buildDraftServerCapabilities(),
			serverInfo: {
				name: this.options.serverName,
				version: this.options.serverVersion,
			},
		});
	}

	handleRootsListChangedNotification(): void {
		if (this.ctx.session.protocolVersion !== MCP_LEGACY_PROTOCOL_VERSION) return;
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

	/** Returns legacy cached client workspace roots, or an empty array if none. */
	getClientRoots(): McpRoot[] {
		return [...this.clientRoots];
	}

	/**
	 * Returns the legacy effective project directory: the first cached client
	 * root's file path when roots are provided, otherwise the configured
	 * projectDir. Draft request handlers resolve roots from MRTR retry payloads.
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
