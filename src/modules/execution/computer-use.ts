import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import {
	linuxClick, linuxCursorPosition, linuxDoubleClick, linuxDrag,
	linuxKey, linuxMove, linuxRightClick, linuxScroll, linuxType,
	macClick, macCursorPosition, macDoubleClick, macDrag,
	macKey, macMove, macRightClick, macScroll, macType,
	resetActionToolState,
} from "./computer-use-actions.js";
import {
	clearLastActionableScreenshot,
	parseCoordinateSpace,
	resolveGuiCoordinates,
} from "./gui-coordinate-scaling.js";

export function resetComputerUseState(): void {
	resetActionToolState();
	clearLastActionableScreenshot();
}

export const computerUseTool: KotaTool = {
	name: "computer_use",
	description:
		"Control mouse and keyboard to interact with the computer GUI. " +
		"Use with screenshot tool to see the screen before/after actions. " +
		'Coordinate actions require coordinate_space: "native" for OS coordinates or "last_screenshot_display" for coordinates measured on the last screenshot image. ' +
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
			coordinate_space: {
				type: "string",
				enum: ["native", "last_screenshot_display"],
				description:
					'Required for coordinate actions. Use "native" for OS coordinates or "last_screenshot_display" for coordinates measured on the last screenshot image.',
			},
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

type RawComputerUseInput = Record<string, unknown>;

type ComputerUseInput = {
	action?: string;
	x?: number;
	y?: number;
	coordinate_space?: string;
	text?: string;
	key_combo?: string;
	start_x?: number;
	start_y?: number;
	direction?: string;
	amount?: number;
};

type ActionFn = (input: ComputerUseInput) => string;

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
		click: (i) => { const [x, y] = needActionCoords(i); return click(x, y); },
		double_click: (i) => { const [x, y] = needActionCoords(i); return dblClick(x, y); },
		right_click: (i) => { const [x, y] = needActionCoords(i); return rClick(x, y); },
		move: (i) => { const [x, y] = needActionCoords(i); return move(x, y); },
		type: (i) => {
			if (!i.text || typeof i.text !== "string") throw new Error("text is required for type action");
			return type_(i.text);
		},
		key: (i) => {
			if (!i.key_combo || typeof i.key_combo !== "string") throw new Error("key_combo is required for key action");
			return key_(i.key_combo);
		},
		drag: (i) => {
			if (typeof i.start_x !== "number" || typeof i.start_y !== "number") {
				throw new Error("start_x and start_y required for drag");
			}
			const space = parseCoordinateSpace(i.coordinate_space);
			const [sx, sy] = resolveGuiCoordinates(i.start_x, i.start_y, space);
			const [ex, ey] = needActionCoords(i);
			return drag(sx, sy, ex, ey);
		},
		scroll: (i) => {
			const dir = i.direction || "down";
			const amt = Math.min(Math.max(i.amount || 3, 1), 20);
			return scroll(dir, amt);
		},
		cursor_position: () => cursorPos(),
	};
}

function needActionCoords(input: ComputerUseInput): [number, number] {
	if (typeof input.x !== "number" || typeof input.y !== "number") {
		throw new Error("x and y coordinates are required for this action");
	}
	const space = parseCoordinateSpace(input.coordinate_space);
	return resolveGuiCoordinates(input.x, input.y, space);
}

export async function runComputerUse(
	rawInput: RawComputerUseInput,
): Promise<ToolResult> {
	const input = normalizeComputerUseInput(rawInput);
	const action = input.action;
	const os = process.platform;
	if (os !== "darwin" && os !== "linux") {
		return {
			content: `Computer use not supported on ${os}. Supported: macOS, Linux.`,
			is_error: true,
		};
	}
	try {
		const actions = buildActions(os);
		if (!action) {
			return { content: `Unknown action: ${String(rawInput.action)}`, is_error: true };
		}
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

function normalizeComputerUseInput(input: RawComputerUseInput): ComputerUseInput {
	return {
		action: readString(input.action),
		x: readNumber(input.x),
		y: readNumber(input.y),
		coordinate_space: readString(input.coordinate_space),
		text: readString(input.text),
		key_combo: readString(input.key_combo),
		start_x: readNumber(input.start_x),
		start_y: readNumber(input.start_y),
		direction: readString(input.direction),
		amount: readNumber(input.amount),
	};
}

function readString(value: RawComputerUseInput[string]): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function readNumber(value: RawComputerUseInput[string]): number | undefined {
	return typeof value === "number" ? value : undefined;
}
