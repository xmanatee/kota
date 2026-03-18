/**
 * Minimal type definitions matching @anthropic-ai/claude-agent-sdk's public API.
 * Used for compile-time safety without requiring the SDK as a hard dependency.
 */

export type SDKQueryOptions = {
	model?: string;
	maxTurns?: number;
	systemPrompt?: string;
	allowedTools?: string[];
	disallowedTools?: string[];
	permissionMode?: "default" | "acceptEdits" | "dontAsk" | "bypassPermissions";
	cwd?: string;
	maxBudgetUsd?: number;
	persistSession?: boolean;
};

export type SDKContentBlock = {
	type: string;
	text?: string;
};

export type SDKMessage = {
	type: string;
	subtype?: string;
	sessionId?: string;
	content?: SDKContentBlock[];
	message?: string;
};

export type SDKQueryFn = (params: {
	prompt: string;
	options?: SDKQueryOptions;
}) => AsyncIterable<SDKMessage>;

export type SDKModule = {
	query: SDKQueryFn;
};
