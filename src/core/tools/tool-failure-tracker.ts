import type { ToolResultEntry } from "./tool-runner-types.js";

export type FailureAction = "continue" | "inject_guidance" | "circuit_break";

/**
 * Tracks consecutive tool failures to detect stuck loops.
 */
export class FailureTracker {
	private consecutiveFailures = 0;
	private lastSignature = "";
	private identicalCount = 0;

	record(results: ToolResultEntry[]): FailureAction {
		const failed = results.filter((result) => result.is_error);

		if (failed.length === 0) {
			this.consecutiveFailures = 0;
			this.identicalCount = 0;
			this.lastSignature = "";
			return "continue";
		}

		this.consecutiveFailures++;
		const signature = failed.map((result) => result.content).join("|");
		if (signature === this.lastSignature) {
			this.identicalCount++;
			if (this.identicalCount >= 3) return "circuit_break";
		} else {
			this.identicalCount = 1;
			this.lastSignature = signature;
		}

		if (this.consecutiveFailures >= 5) {
			this.consecutiveFailures = 0;
			return "inject_guidance";
		}

		return "continue";
	}

	static getMessage(action: FailureAction): string {
		if (action === "circuit_break") {
			return "You have failed the same way 3 times in a row. Stop and explain what's going wrong.";
		}
		if (action === "inject_guidance") {
			return (
				"You have had 5 consecutive tool failures with different errors. " +
				"Step back and reconsider: re-read relevant files, try a different strategy, " +
				"or break the task into smaller steps."
			);
		}
		return "";
	}
}
