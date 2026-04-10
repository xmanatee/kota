import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type Anthropic from "@anthropic-ai/sdk";
import { getEventBus } from "../events/event-bus.js";
import type { ToolResult } from "./index.js";

export const confirmTool: Anthropic.Tool = {
	name: "confirm",
	description:
		"Request human approval before executing a high-stakes action. " +
		"Use before irreversible operations (deleting data, sending messages, deploying, " +
		"financial transactions) in autonomous workflows. Returns approved/rejected with optional reason.",
	input_schema: {
		type: "object" as const,
		properties: {
			action: {
				type: "string",
				description: "What you want to do — be specific so the human can make an informed decision",
			},
			risk: {
				type: "string",
				enum: ["low", "medium", "high"],
				description: "Risk level (default: medium). Affects default timeout: low=60s, medium=300s, high=600s",
			},
			details: {
				type: "string",
				description: "Additional context to help the human decide (affected files, scope, etc.)",
			},
			timeout: {
				type: "number",
				description: "Timeout in seconds. Auto-rejects on expiry. Overrides risk-based default.",
			},
		},
		required: ["action"],
	},
};

export type ConfirmResult = {
	approved: boolean;
	reason?: string;
};

type ConfirmInput = {
	action: string;
	risk?: string;
	details?: string;
	timeout?: number;
};

const RISK_TIMEOUTS: Record<string, number> = {
	low: 60,
	medium: 300,
	high: 600,
};

let confirmOverride: ((input: ConfirmInput) => Promise<ConfirmResult>) | null = null;

export function setConfirmOverride(fn: ((input: ConfirmInput) => Promise<ConfirmResult>) | null): void {
	confirmOverride = fn;
}

export async function runConfirm(input: Record<string, unknown>): Promise<ToolResult> {
	const action = input.action as string;
	if (!action?.trim()) {
		return { content: "Error: action is required", is_error: true };
	}

	const risk = (input.risk as string) || "medium";
	if (!["low", "medium", "high"].includes(risk)) {
		return { content: `Error: risk must be low, medium, or high (got "${risk}")`, is_error: true };
	}

	const details = (input.details as string) || undefined;
	const timeout = typeof input.timeout === "number" ? input.timeout : RISK_TIMEOUTS[risk];
	const confirmInput: ConfirmInput = { action, risk, details, timeout };

	const bus = getEventBus();
	bus?.emit("confirm.requested", { action, risk, details: details ?? "", timeout });

	let result: ConfirmResult;
	try {
		result = confirmOverride
			? await confirmOverride(confirmInput)
			: await promptApproval(confirmInput);
	} catch {
		result = { approved: false, reason: "No interactive terminal — auto-rejected" };
	}

	bus?.emit("confirm.resolved", {
		action,
		risk,
		approved: result.approved,
		reason: result.reason ?? "",
	});

	const status = result.approved ? "APPROVED" : "REJECTED";
	const reasonLine = result.reason ? `\nReason: ${result.reason}` : "";
	return { content: `${status}: ${action}${reasonLine}` };
}

function promptApproval(input: ConfirmInput): Promise<ConfirmResult> {
	return new Promise((resolve, reject) => {
		let ttyStream: ReturnType<typeof createReadStream> | undefined;
		try {
			ttyStream = createReadStream("/dev/tty", { encoding: "utf-8" });
		} catch {
			reject(new Error("Cannot open /dev/tty"));
			return;
		}

		const rl = createInterface({
			input: ttyStream,
			output: process.stderr,
			terminal: false,
		});

		const dim = process.stderr.isTTY ? "\x1b[2m" : "";
		const bold = process.stderr.isTTY ? "\x1b[1m" : "";
		const yellow = process.stderr.isTTY ? "\x1b[33m" : "";
		const reset = process.stderr.isTTY ? "\x1b[0m" : "";

		const riskLabel = `[${input.risk?.toUpperCase() ?? "MEDIUM"} risk]`;
		const detailLine = input.details ? `\n${dim}Details: ${input.details}${reset}` : "";

		process.stderr.write(
			`\n${dim}─────────────────────────────────────${reset}\n` +
				`${bold}${yellow}[kota] Approval requested ${riskLabel}:${reset}\n` +
				`${input.action}${detailLine}\n` +
				`${dim}Timeout: ${input.timeout}s — auto-rejects on expiry${reset}\n` +
				`${dim}─────────────────────────────────────${reset}\n` +
				`Approve? [y/N] `,
		);

		const timer = setTimeout(() => {
			cleanup();
			resolve({ approved: false, reason: "Timed out" });
		}, (input.timeout ?? 300) * 1000);

		function cleanup() {
			clearTimeout(timer);
			rl.close();
			ttyStream?.destroy();
		}

		rl.once("line", (answer) => {
			cleanup();
			const trimmed = answer.trim().toLowerCase();
			const approved = trimmed === "y" || trimmed === "yes";
			resolve({ approved, reason: approved ? undefined : trimmed || undefined });
		});

		rl.once("error", (err) => {
			cleanup();
			reject(err);
		});
	});
}

export const registration = {
	tool: confirmTool,
	runner: runConfirm,
	risk: "safe" as const,
	kind: "action" as const,
	group: "management",
};
