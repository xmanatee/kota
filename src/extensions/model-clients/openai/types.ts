/**
 * Minimal OpenAI API type subset used by the compatibility layer.
 */

export type OAIMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string }
	| { role: "assistant"; content: string | null; tool_calls?: OAIToolCall[] }
	| { role: "tool"; tool_call_id: string; content: string };

export type OAIToolCall = {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
};

export type OAITool = {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
};

export type OAIStreamChunk = {
	id: string;
	choices: Array<{
		index: number;
		delta: {
			role?: string;
			content?: string | null;
			tool_calls?: Array<{
				index: number;
				id?: string;
				type?: string;
				function?: { name?: string; arguments?: string };
			}>;
		};
		finish_reason: string | null;
	}>;
	model: string;
	usage?: { prompt_tokens: number; completion_tokens: number };
};

export type OAIResponse = {
	id: string;
	choices: Array<{
		message: {
			role: string;
			content: string | null;
			tool_calls?: OAIToolCall[];
		};
		finish_reason: string;
	}>;
	model: string;
	usage?: { prompt_tokens: number; completion_tokens: number };
};
