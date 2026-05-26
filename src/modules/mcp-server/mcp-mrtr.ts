/**
 * Shared Multi Round-Trip Request helpers for modern MCP server-to-client
 * requests. This owns strict retry decoding and opaque request-state
 * integrity so feature handlers do not each grow a protocol dialect.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type {
	KotaJsonObject,
	KotaJsonValue,
} from "#core/agent-harness/message-protocol.js";
import type {
	ElicitationResponse,
	HandlerContext,
	JsonRpcRequest,
	McpElicitationMode,
	McpInputRequest,
	McpInputRequests,
	McpInputRequiredResult,
	McpInputResponses,
	McpRoot,
	McpRootsInputResponse,
	McpSamplingContentBlock,
	McpSamplingCreateMessageResult,
} from "./mcp-protocol-types.js";
import {
	activeClientSupportsRoots,
	activeMcpProtocolVersion,
	mcpProtocolSupports,
} from "./mcp-protocol-types.js";

export const ROOTS_INPUT_REQUEST_ID = "roots";

type MrtrRetryParams =
	| { kind: "none" }
	| { kind: "invalid"; message: string }
	| { kind: "retry"; requestState: string; inputResponses: McpInputResponses };

export type MrtrInputResponsesDecode =
	| { ok: true; inputResponses: McpInputResponses }
	| { ok: false; message: string };

type MrtrStatePayload = {
	version: 1;
	method: string;
	paramsDigest: string;
	inputRequestIds: string[];
	nonce: string;
};

type StateVerification =
	| { ok: true; inputRequestIds: string[] }
	| { ok: false; message: string };

type ProjectDirResolution =
	| { kind: "ready"; projectDir: string }
	| { kind: "input_required"; result: McpInputRequiredResult }
	| { kind: "error"; message: string };

function isJsonObject(value: KotaJsonValue | undefined): value is KotaJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortJsonValue(value: KotaJsonValue): KotaJsonValue {
	if (Array.isArray(value)) return value.map(sortJsonValue);
	if (!isJsonObject(value)) return value;
	const out: KotaJsonObject = {};
	for (const key of Object.keys(value).sort()) {
		out[key] = sortJsonValue(value[key]);
	}
	return out;
}

function normalizedRequestParams(params: KotaJsonObject): KotaJsonObject {
	const out: KotaJsonObject = {};
	for (const key of Object.keys(params).sort()) {
		if (key === "_meta" || key === "inputResponses" || key === "requestState") continue;
		out[key] = sortJsonValue(params[key]);
	}
	return out;
}

function requestParamsDigest(params: KotaJsonObject): string {
	return createHash("sha256")
		.update(JSON.stringify(normalizedRequestParams(params)))
		.digest("base64url");
}

function sameStringArray(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
}

function parseStatePayload(value: KotaJsonValue): MrtrStatePayload | null {
	if (!isJsonObject(value)) return null;
	if (value.version !== 1) return null;
	if (typeof value.method !== "string") return null;
	if (typeof value.paramsDigest !== "string") return null;
	if (!Array.isArray(value.inputRequestIds)) return null;
	if (!value.inputRequestIds.every((id) => typeof id === "string")) return null;
	if (typeof value.nonce !== "string") return null;
	return {
		version: 1,
		method: value.method,
		paramsDigest: value.paramsDigest,
		inputRequestIds: value.inputRequestIds,
		nonce: value.nonce,
	};
}

function decodeStatePayload(encoded: string): MrtrStatePayload | null {
	try {
		const raw = Buffer.from(encoded, "base64url").toString("utf-8");
		return parseStatePayload(JSON.parse(raw) as KotaJsonValue);
	} catch {
		return null;
	}
}

function decodeInputResponse(value: KotaJsonValue, requestId: string): McpInputResponses[string] | string {
	if (!isJsonObject(value)) return `inputResponses.${requestId} must be an object`;
	if ("roots" in value) return decodeRootsInputResponseValue(value, requestId);
	if ("action" in value) return decodeElicitationInputResponseValue(value, requestId);
	if ("role" in value && "content" in value && "model" in value) {
		return decodeSamplingInputResponseValue(value, requestId);
	}
	return `inputResponses.${requestId} must be an elicitation, roots, or sampling response`;
}

function decodeElicitationInputResponseValue(
	value: KotaJsonObject,
	requestId: string,
): ElicitationResponse | string {
	if (
		value.action !== "accept" &&
		value.action !== "decline" &&
		value.action !== "reject" &&
		value.action !== "cancel"
	) {
		return `inputResponses.${requestId}.action must be accept, decline, or cancel`;
	}
	if (value.action === "accept") {
		if (value.content !== undefined && !isJsonObject(value.content)) {
			return `inputResponses.${requestId}.content must be an object when action is accept`;
		}
		return value.content === undefined
			? { action: "accept" }
			: { action: "accept", content: value.content };
	}
	// Legacy draft examples used `reject`; keep it as a narrow inbound alias
	// while normalizing the first-party server boundary to current `decline`.
	if (value.action === "decline" || value.action === "reject") {
		return { action: "decline" };
	}
	return { action: "cancel" };
}

function decodeRootsInputResponseValue(
	value: KotaJsonObject,
	requestId: string,
): McpRootsInputResponse | string {
	if (!Array.isArray(value.roots)) {
		return `inputResponses.${requestId}.roots must be an array`;
	}
	const roots: McpRoot[] = [];
	for (const [index, rawRoot] of value.roots.entries()) {
		if (!isJsonObject(rawRoot)) {
			return `inputResponses.${requestId}.roots.${index} must be an object`;
		}
		if (typeof rawRoot.uri !== "string") {
			return `inputResponses.${requestId}.roots.${index}.uri must be a string`;
		}
		const root: McpRoot = { uri: rawRoot.uri };
		if (rawRoot.name !== undefined) {
			if (typeof rawRoot.name !== "string") {
				return `inputResponses.${requestId}.roots.${index}.name must be a string`;
			}
			root.name = rawRoot.name;
		}
		roots.push(root);
	}
	return { roots };
}

function isRootsInputResponse(value: McpInputResponses[string]): value is McpRootsInputResponse {
	return "roots" in value;
}

function isElicitationInputResponse(
	value: McpInputResponses[string],
): value is ElicitationResponse {
	return "action" in value;
}

function decodeSamplingInputResponseValue(
	value: KotaJsonObject,
	requestId: string,
): McpSamplingCreateMessageResult | string {
	const role = value.role;
	if (role !== "user" && role !== "assistant") {
		return `inputResponses.${requestId}.role must be user or assistant`;
	}
	if (typeof value.model !== "string") {
		return `inputResponses.${requestId}.model must be a string`;
	}
	if (value.stopReason !== undefined && typeof value.stopReason !== "string") {
		return `inputResponses.${requestId}.stopReason must be a string`;
	}
	const content = decodeSamplingContentValue(value.content, `inputResponses.${requestId}.content`);
	if (typeof content === "string") return content;
	return {
		role,
		content,
		model: value.model,
		...(value.stopReason !== undefined ? { stopReason: value.stopReason } : {}),
	};
}

function decodeSamplingContentValue(
	value: KotaJsonValue | undefined,
	label: string,
): McpSamplingContentBlock | McpSamplingContentBlock[] | string {
	if (Array.isArray(value)) {
		const blocks: McpSamplingContentBlock[] = [];
		for (const [index, entry] of value.entries()) {
			const block = decodeSamplingContentBlock(entry, `${label}[${index}]`);
			if (typeof block === "string") return block;
			blocks.push(block);
		}
		return blocks;
	}
	return decodeSamplingContentBlock(value, label);
}

function decodeSamplingContentBlock(
	value: KotaJsonValue | undefined,
	label: string,
): McpSamplingContentBlock | string {
	if (!isJsonObject(value)) return `${label} must be an object`;
	if (typeof value.type !== "string") return `${label}.type must be a string`;
	const meta = value._meta === undefined
		? undefined
		: isJsonObject(value._meta)
			? value._meta
			: null;
	if (meta === null) return `${label}._meta must be an object`;
	if (value.type === "text") {
		if (typeof value.text !== "string") return `${label}.text must be a string`;
		return { type: "text", text: value.text, ...(meta ? { _meta: meta } : {}) };
	}
	if (value.type === "image" || value.type === "audio") {
		if (typeof value.data !== "string") return `${label}.data must be a string`;
		if (typeof value.mimeType !== "string") return `${label}.mimeType must be a string`;
		return {
			type: value.type,
			data: value.data,
			mimeType: value.mimeType,
			...(meta ? { _meta: meta } : {}),
		};
	}
	if (value.type === "tool_use") {
		if (typeof value.id !== "string") return `${label}.id must be a string`;
		if (typeof value.name !== "string") return `${label}.name must be a string`;
		if (!isJsonObject(value.input)) return `${label}.input must be an object`;
		return {
			type: "tool_use",
			id: value.id,
			name: value.name,
			input: value.input,
			...(meta ? { _meta: meta } : {}),
		};
	}
	if (value.type === "tool_result") {
		if (typeof value.toolUseId !== "string") return `${label}.toolUseId must be a string`;
		if (!Array.isArray(value.content)) return `${label}.content must be an array`;
		const content = [];
		for (const [index, entry] of value.content.entries()) {
			const block = decodeSamplingContentBlock(entry, `${label}.content[${index}]`);
			if (typeof block === "string") return block;
			if (block.type === "tool_use" || block.type === "tool_result") {
				return `${label}.content[${index}].type must not be tool_use or tool_result`;
			}
			content.push(block);
		}
		if (value.structuredContent !== undefined && !isJsonObject(value.structuredContent)) {
			return `${label}.structuredContent must be an object`;
		}
		if (value.isError !== undefined && typeof value.isError !== "boolean") {
			return `${label}.isError must be a boolean`;
		}
		return {
			type: "tool_result",
			toolUseId: value.toolUseId,
			content,
			...(value.structuredContent !== undefined
				? { structuredContent: value.structuredContent }
				: {}),
			...(value.isError !== undefined ? { isError: value.isError } : {}),
			...(meta ? { _meta: meta } : {}),
		};
	}
	return `${label}.type must be text, image, audio, tool_use, or tool_result`;
}

export function decodeMrtrRetryParams(params: KotaJsonObject): MrtrRetryParams {
	const hasInputResponses = Object.hasOwn(params, "inputResponses");
	const hasRequestState = Object.hasOwn(params, "requestState");
	if (!hasInputResponses && !hasRequestState) return { kind: "none" };
	if (!hasInputResponses || !hasRequestState) {
		return {
			kind: "invalid",
			message: "Retry calls must include both inputResponses and requestState",
		};
	}
	if (typeof params.requestState !== "string" || params.requestState.length === 0) {
		return { kind: "invalid", message: "requestState must be a non-empty string" };
	}
	const decoded = decodeMrtrInputResponses(params.inputResponses);
	if (!decoded.ok) return { kind: "invalid", message: decoded.message };
	return {
		kind: "retry",
		requestState: params.requestState,
		inputResponses: decoded.inputResponses,
	};
}

export function decodeMrtrInputResponses(
	value: KotaJsonValue | undefined,
): MrtrInputResponsesDecode {
	if (!isJsonObject(value)) return { ok: false, message: "inputResponses must be an object" };
	const inputResponses: McpInputResponses = {};
	for (const [requestId, response] of Object.entries(value)) {
		const decoded = decodeInputResponse(response, requestId);
		if (typeof decoded === "string") return { ok: false, message: decoded };
		inputResponses[requestId] = decoded;
	}
	return { ok: true, inputResponses };
}

export function readElicitationInputResponse(
	inputResponses: McpInputResponses,
	requestId: string,
	mode: McpElicitationMode = "form",
): ElicitationResponse | string {
	const response = inputResponses[requestId];
	if (!response) return `Missing input response for request "${requestId}"`;
	if (!isElicitationInputResponse(response)) {
		return `inputResponses.${requestId} must be an elicitation response`;
	}
	if (response.action === "accept" && mode === "form" && !isJsonObject(response.content)) {
		return `inputResponses.${requestId}.content must be an object when action is accept`;
	}
	if (response.action === "accept" && mode === "url" && response.content !== undefined) {
		return `inputResponses.${requestId}.content must be omitted for URL-mode accept`;
	}
	return response;
}

export function readRootsInputResponse(
	inputResponses: McpInputResponses,
	requestId = ROOTS_INPUT_REQUEST_ID,
): McpRoot[] | string {
	const response = inputResponses[requestId];
	if (!response) return `Missing input response for request "${requestId}"`;
	if (!isRootsInputResponse(response)) {
		return `inputResponses.${requestId} must be a roots response`;
	}
	return response.roots;
}

export function rootsToProjectDir(roots: McpRoot[], fallbackProjectDir: string): string {
	const firstUri = roots[0]?.uri;
	if (firstUri?.startsWith("file://")) {
		try {
			return new URL(firstUri).pathname;
		} catch {
			return fallbackProjectDir;
		}
	}
	return fallbackProjectDir;
}

export function rootsListInputRequest(): McpInputRequest {
	return { method: "roots/list" };
}

export function resolveProjectDirFromRootsInput(args: {
	ctx: HandlerContext;
	mrtr: McpMrtrStateCodec;
	msg: JsonRpcRequest;
	fallbackProjectDir: string;
}): ProjectDirResolution {
	const retry = decodeMrtrRetryParams(args.msg.params ?? {});
	if (retry.kind === "invalid") return { kind: "error", message: retry.message };

	const supportsMrtr = mcpProtocolSupports(
		activeMcpProtocolVersion(args.ctx),
		"multiRoundTripRequests",
	);
	if (retry.kind === "retry") {
		if (!supportsMrtr) {
			return {
				kind: "error",
				message: "inputResponses are only supported by the modern MRTR protocol",
			};
		}
		if (!activeClientSupportsRoots(args.ctx)) {
			return { kind: "error", message: "Client does not support roots" };
		}
		const verified = args.mrtr.verify(retry.requestState, args.msg, [
			ROOTS_INPUT_REQUEST_ID,
		]);
		if (!verified.ok) return { kind: "error", message: verified.message };
		const roots = readRootsInputResponse(retry.inputResponses);
		if (typeof roots === "string") return { kind: "error", message: roots };
		return {
			kind: "ready",
			projectDir: rootsToProjectDir(roots, args.fallbackProjectDir),
		};
	}

	if (supportsMrtr && activeClientSupportsRoots(args.ctx)) {
		return {
			kind: "input_required",
			result: args.mrtr.createInputRequiredResult(args.msg, {
				[ROOTS_INPUT_REQUEST_ID]: rootsListInputRequest(),
			}),
		};
	}

	return { kind: "ready", projectDir: args.fallbackProjectDir };
}

export class McpMrtrStateCodec {
	private readonly secret = randomBytes(32);

	createInputRequiredResult(msg: JsonRpcRequest, inputRequests: McpInputRequests): McpInputRequiredResult {
		return {
			resultType: "input_required",
			inputRequests,
			requestState: this.createState(msg.method, msg.params ?? {}, Object.keys(inputRequests).sort()),
		};
	}

	verify(
		requestState: string,
		msg: JsonRpcRequest,
		expectedInputRequestIds: string[],
	): StateVerification {
		const payload = this.openState(requestState);
		if (!payload) return { ok: false, message: "Invalid requestState" };
		if (payload.method !== msg.method) {
			return { ok: false, message: "requestState does not match requested method" };
		}
		if (payload.paramsDigest !== requestParamsDigest(msg.params ?? {})) {
			return { ok: false, message: "requestState does not match requested parameters" };
		}
		if (!sameStringArray(payload.inputRequestIds, [...expectedInputRequestIds].sort())) {
			return { ok: false, message: "requestState does not match expected input requests" };
		}
		return { ok: true, inputRequestIds: payload.inputRequestIds };
	}

	private createState(method: string, params: KotaJsonObject, inputRequestIds: string[]): string {
		const payload: MrtrStatePayload = {
			version: 1,
			method,
			paramsDigest: requestParamsDigest(params),
			inputRequestIds,
			nonce: randomBytes(16).toString("base64url"),
		};
		const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
		return `${encoded}.${this.sign(encoded)}`;
	}

	private openState(requestState: string): MrtrStatePayload | null {
		const parts = requestState.split(".");
		if (parts.length !== 2) return null;
		const [encoded, signature] = parts;
		if (!this.signatureMatches(encoded, signature)) return null;
		return decodeStatePayload(encoded);
	}

	private sign(encodedPayload: string): string {
		return createHmac("sha256", this.secret)
			.update(encodedPayload)
			.digest("base64url");
	}

	private signatureMatches(encodedPayload: string, signature: string): boolean {
		const expected = Buffer.from(this.sign(encodedPayload), "base64url");
		const actual = Buffer.from(signature, "base64url");
		return expected.length === actual.length && timingSafeEqual(expected, actual);
	}
}
