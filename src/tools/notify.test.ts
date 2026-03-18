import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
}));

vi.mock("node:os", () => ({
	platform: vi.fn(),
}));

const { execFileSync } = await import("node:child_process");
const { platform } = await import("node:os");
const mockExec = vi.mocked(execFileSync);
const mockPlatform = vi.mocked(platform);

const { runNotify, sendDesktopNotification } = await import("./notify.js");

beforeEach(() => {
	mockExec.mockReset();
	mockPlatform.mockReset();
	mockPlatform.mockReturnValue("darwin");
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("notify tool", () => {
	describe("runNotify", () => {
		it("rejects empty message", async () => {
			const result = await runNotify({ message: "" });
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("message is required");
		});

		it("rejects whitespace-only message", async () => {
			const result = await runNotify({ message: "   " });
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("message is required");
		});

		it("sends notification with default title", async () => {
			const result = await runNotify({ message: "Task complete" });
			expect(result.is_error).toBeUndefined();
			expect(result.content).toContain("Notification sent");
			expect(result.content).toContain("KOTA");
			expect(result.content).toContain("Task complete");
		});

		it("sends notification with custom title", async () => {
			const result = await runNotify({ message: "Done", title: "Build" });
			expect(result.is_error).toBeUndefined();
			expect(result.content).toContain("Build");
			expect(result.content).toContain("Done");
		});

		it("falls back to console when desktop fails", async () => {
			mockExec.mockImplementation(() => {
				throw new Error("no display");
			});

			const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
			const result = await runNotify({ message: "Fallback test" });

			expect(result.content).toContain("Desktop notification failed");
			expect(result.content).toContain("console notification sent");
			stderrSpy.mockRestore();
		});
	});

	describe("sendDesktopNotification", () => {
		it("uses macOS osascript on darwin", () => {
			mockPlatform.mockReturnValue("darwin");
			const result = sendDesktopNotification("hello", "KOTA", true);
			expect(result.channel).toBe("desktop");
			expect(result.delivered).toBe(true);
			expect(mockExec).toHaveBeenCalledWith(
				"osascript",
				expect.arrayContaining(["-e"]),
				expect.objectContaining({ timeout: 5000 }),
			);
		});

		it("includes sound clause by default on macOS", () => {
			mockPlatform.mockReturnValue("darwin");
			sendDesktopNotification("test", "KOTA", true);
			const args = mockExec.mock.calls[0];
			const script = args[1]?.[1] as string;
			expect(script).toContain('sound name "Glass"');
		});

		it("omits sound clause when sound=false on macOS", () => {
			mockPlatform.mockReturnValue("darwin");
			sendDesktopNotification("test", "KOTA", false);
			const args = mockExec.mock.calls[0];
			const script = args[1]?.[1] as string;
			expect(script).not.toContain("sound name");
		});

		it("escapes quotes in macOS notification", () => {
			mockPlatform.mockReturnValue("darwin");
			sendDesktopNotification('He said "hi"', "KOTA", true);
			const args = mockExec.mock.calls[0];
			const script = args[1]?.[1] as string;
			expect(script).toContain('\\"');
		});

		it("escapes backslashes in macOS notification", () => {
			mockPlatform.mockReturnValue("darwin");
			sendDesktopNotification("path\\to\\file", "KOTA", true);
			const args = mockExec.mock.calls[0];
			const script = args[1]?.[1] as string;
			expect(script).toContain("\\\\");
		});

		it("uses notify-send on linux", () => {
			mockPlatform.mockReturnValue("linux");
			const result = sendDesktopNotification("hello", "KOTA", true);
			expect(result.channel).toBe("desktop");
			expect(result.delivered).toBe(true);
			expect(mockExec).toHaveBeenCalledWith(
				"notify-send",
				["KOTA", "hello"],
				expect.objectContaining({ timeout: 5000 }),
			);
		});

		it("reports ENOENT on linux when notify-send missing", () => {
			mockPlatform.mockReturnValue("linux");
			mockExec.mockImplementation(() => {
				const err = new Error("not found") as NodeJS.ErrnoException;
				err.code = "ENOENT";
				throw err;
			});

			const result = sendDesktopNotification("test", "KOTA", true);
			expect(result.delivered).toBe(false);
			expect(result.error).toContain("notify-send not found");
		});

		it("falls back to console on unsupported platform", () => {
			mockPlatform.mockReturnValue("freebsd" as NodeJS.Platform);
			const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
			const result = sendDesktopNotification("test", "KOTA", true);
			expect(result.channel).toBe("console");
			expect(result.delivered).toBe(true);
			stderrSpy.mockRestore();
		});

		it("reports desktop failure when osascript fails", () => {
			mockPlatform.mockReturnValue("darwin");
			mockExec.mockImplementation(() => {
				throw new Error("osascript error");
			});

			const result = sendDesktopNotification("test", "KOTA", true);
			expect(result.channel).toBe("desktop");
			expect(result.delivered).toBe(false);
			expect(result.error).toContain("osascript error");
		});
	});
});
