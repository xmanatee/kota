import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "../../core/tools/tool-result.js";
import {
	linuxClick, linuxCursorPosition, linuxDoubleClick, linuxDrag,
	linuxKey, linuxMove, linuxRightClick, linuxScroll, linuxType,
	macClick, macCursorPosition, macDoubleClick, macDrag,
	macKey, macMove, macRightClick, macScroll, macType,
	needCoords,
} from "./computer-use-actions.js";

export { resetComputerUseState } from "./computer-use-actions.js";

export const computerUseTool: Anthropic.Tool = {
	name: "computer_use",
	description:
		"Control mouse and keyboard to interact with the computer GUI. " +
		"Use with screenshot tool to see the screen before/after actions. " +
		"macOS: needs cliclick for mouse (brew install cliclick), osascript for keyboard. " +
		"Linux: needs xdotool. Requires Accessibility permissions on macOS.",
	input_schema: {
		type: "object" as const,
		properties: {
			action: {
				type: "string",
				enum: [
					"click",
					"double_click",
					"right_click",
					"type",
					"key",
					"move",
					"drag",
					"scroll",
					"cursor_position",
				],
				description: "Action to perform",
			},
			x: { type: "number", description: "X coordinate" },
			y: { type: "number", description: "Y coordinate" },
			text: { type: "string", description: "Text to type (for type action)" },
			key_combo: {
				type: "string",
				description:
					'Key combo (for key action). E.g. "enter", "cmd+c", "ctrl+shift+z"',
			},
			start_x: { type: "number", description: "Drag start X" },
			start_y: { type: "number", description: "Drag start Y" },
			direction: {
				type: "string",
				enum: ["up", "down"],
				description: "Scroll direction",
			},
			amount: { type: "number", description: "Scroll steps (default 3)" },
		},
		required: ["action"],
	},
};

type ActionFn = (input: Record<string, unknown>) => string;

function buildActions(os: string): Record<string, ActionFn> {
	const isDarwin = os === "darwin";
	const click = isDarwin ? macClick : linuxClick;
	const dblClick = isDarwin ? macDoubleClick : linuxDoubleClick;
	const rClick = isDarwin ? macRightClick : linuxRightClick;
	const move = isDarwin ? macMove : linuxMove;
	const drag = isDarwin ? macDrag : linuxDrag;
	const type_ = isDarwin ? macType : linuxType;
	const key_ = isDarwin ? macKey : linuxKey;
	const scroll = isDarwin ? macScroll : linuxScroll;
	const cursorPos = isDarwin ? macCursorPosition : linuxCursorPosition;

	return {
		click: (i) => { const [x, y] = needCoords(i.x, i.y); return click(x, y); },
		double_click: (i) => { const [x, y] = needCoords(i.x, i.y); return dblClick(x, y); },
		right_click: (i) => { const [x, y] = needCoords(i.x, i.y); return rClick(x, y); },
		move: (i) => { const [x, y] = needCoords(i.x, i.y); return move(x, y); },
		type: (i) => {
			if (!i.text || typeof i.text !== "string") throw new Error("text is required for type action");
			return type_(i.text as string);
		},
		key: (i) => {
			if (!i.key_combo || typeof i.key_combo !== "string") throw new Error("key_combo is required for key action");
			return key_(i.key_combo as string);
		},
		drag: (i) => {
			if (typeof i.start_x !== "number" || typeof i.start_y !== "number") {
				throw new Error("start_x and start_y required for drag");
			}
			const [ex, ey] = needCoords(i.x, i.y);
			return drag(Math.round(i.start_x as number), Math.round(i.start_y as number), ex, ey);
		},
		scroll: (i) => {
			const dir = (i.direction as string) || "down";
			const amt = Math.min(Math.max((i.amount as number) || 3, 1), 20);
			return scroll(dir, amt);
		},
		cursor_position: () => cursorPos(),
	};
}

export async function runComputerUse(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const action = input.action as string;
	const os = process.platform;
	if (os !== "darwin" && os !== "linux") {
		return {
			content: `Computer use not supported on ${os}. Supported: macOS, Linux.`,
			is_error: true,
		};
	}
	try {
		const actions = buildActions(os);
		const fn = actions[action];
		if (!fn) return { content: `Unknown action: ${action}`, is_error: true };
		return { content: fn(input) };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (
			msg.includes("not allowed") ||
			msg.includes("accessibility") ||
			msg.includes("assistive")
		) {
			return {
				content: `Accessibility permission required. macOS: System Settings > Privacy & Security > Accessibility — add your terminal app. Error: ${msg}`,
				is_error: true,
			};
		}
		return { content: `Computer use failed: ${msg}`, is_error: true };
	}
}

export const registration = {
	tool: computerUseTool,
	runner: runComputerUse,
	risk: "moderate" as const,
	kind: "action" as const,
	group: "gui",
};
