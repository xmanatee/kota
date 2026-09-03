import { describe, expect, it } from "vitest";
import { runEnvInfo } from "./env-info.js";

describe("runEnvInfo", () => {
	it("returns error for unknown query", async () => {
		const result = await runEnvInfo({ query: "bogus" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Unknown query");
	});

	describe("os query", () => {
		it("returns platform, arch, hostname, user", async () => {
			const result = await runEnvInfo({ query: "os" });
			expect(result.is_error).toBeUndefined();
			expect(result.content).toContain("## OS");
			expect(result.content).toContain("platform:");
			expect(result.content).toContain("arch:");
			expect(result.content).toContain("hostname:");
			expect(result.content).toContain("user:");
			expect(result.content).toContain("shell:");
			expect(result.content).toContain("uptime:");
		});

		it("platform matches process.platform", async () => {
			const result = await runEnvInfo({ query: "os" });
			expect(result.content).toContain(`platform: ${process.platform}`);
		});
	});

	describe("runtimes query", () => {
		it("detects Node.js (we're running it)", async () => {
			const result = await runEnvInfo({ query: "runtimes" });
			expect(result.is_error).toBeUndefined();
			expect(result.content).toContain("## Runtimes");
			expect(result.content).toContain("node:");
		}, 10_000);

		it("includes package managers section", async () => {
			const result = await runEnvInfo({ query: "runtimes" });
			expect(result.content).toContain("## Package Managers");
		}, 10_000);

		it("detects npm (we're in a Node project)", async () => {
			const result = await runEnvInfo({ query: "runtimes" });
			expect(result.content).toContain("npm:");
		}, 10_000);
	});

	describe("services query", () => {
		it("returns services section", async () => {
			const result = await runEnvInfo({ query: "services" });
			expect(result.is_error).toBeUndefined();
			expect(result.content).toContain("## Services");
		});

		it("reports docker status", async () => {
			const result = await runEnvInfo({ query: "services" });
			expect(result.content).toMatch(/docker: ([\d.]+ \(|not available)/);
		});
	});

	describe("resources query", () => {
		it("returns CPU, memory info", async () => {
			const result = await runEnvInfo({ query: "resources" });
			expect(result.is_error).toBeUndefined();
			expect(result.content).toContain("## Resources");
			expect(result.content).toContain("cpu:");
			expect(result.content).toContain("memory:");
		});

		it("memory shows used/total/free", async () => {
			const result = await runEnvInfo({ query: "resources" });
			expect(result.content).toMatch(/memory:.*used.*total.*free/);
		});
	});

	describe("all query", () => {
		it("returns all sections", async () => {
			const result = await runEnvInfo({ query: "all" });
			expect(result.is_error).toBeUndefined();
			expect(result.content).toContain("## OS");
			expect(result.content).toContain("## Runtimes");
			expect(result.content).toContain("## Services");
			expect(result.content).toContain("## Resources");
		}, 15_000);
	});

	it("defaults to all when query not provided", async () => {
		const result = await runEnvInfo({});
		expect(result.content).toContain("## OS");
		expect(result.content).toContain("## Runtimes");
		expect(result.content).toContain("## Resources");
	}, 15_000);
});
