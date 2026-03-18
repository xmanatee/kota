import { describe, expect, it } from "vitest";
import { validateManifest } from "./validation.js";

describe("validateManifest edge cases", () => {
	it("rejects array as manifest root", () => {
		const errors = validateManifest([{ name: "test" }]);
		expect(errors).toHaveLength(1);
		expect(errors[0].field).toBe("root");
	});

	it("rejects null tools entry", () => {
		const errors = validateManifest({
			name: "test-mod",
			tools: [null],
		});
		expect(errors.some((e) => e.message === "each tool must be an object")).toBe(true);
	});

	it("rejects tool with empty name string", () => {
		const errors = validateManifest({
			name: "test-mod",
			tools: [{ name: "", description: "desc", code: "print(1)" }],
		});
		expect(errors.some((e) => e.field === "tools[0].name")).toBe(true);
	});

	it("rejects tool parameters that are null", () => {
		const errors = validateManifest({
			name: "test-mod",
			tools: [{
				name: "null_params",
				description: "Test",
				code: "print(1)",
				parameters: null,
			}],
		});
		expect(errors.some((e) => e.field === "tools[0].parameters")).toBe(true);
	});

	it("rejects tool parameters that are an array", () => {
		const errors = validateManifest({
			name: "test-mod",
			tools: [{
				name: "arr_params",
				description: "Test",
				code: "print(1)",
				parameters: [1, 2, 3],
			}],
		});
		expect(errors.some((e) => e.field === "tools[0].parameters")).toBe(true);
	});

	it("rejects tools as non-array type", () => {
		const errors = validateManifest({
			name: "test-mod",
			tools: "not-an-array",
		});
		expect(errors.some((e) => e.field === "tools" && e.message === "tools must be an array")).toBe(true);
	});

	it("rejects dependencies with non-string elements", () => {
		const errors = validateManifest({
			name: "test-mod",
			dependencies: ["valid", 42],
		});
		expect(errors.some((e) => e.field === "dependencies")).toBe(true);
	});

	it("reports multiple errors at once", () => {
		const errors = validateManifest({
			// Missing name
			tools: [{ name: "AB" }], // invalid format + missing fields
			promptSection: 123,
		});
		expect(errors.length).toBeGreaterThanOrEqual(3);
	});

	it("rejects event handler with empty event string", () => {
		const errors = validateManifest({
			name: "test-mod",
			eventHandlers: [{ event: "", code: "print(1)" }],
		});
		expect(errors.some((e) => e.field === "eventHandlers[0].event")).toBe(true);
	});

	it("rejects scripts as null", () => {
		const errors = validateManifest({
			name: "test-mod",
			scripts: null,
		});
		expect(errors.some((e) => e.field === "scripts")).toBe(true);
	});

	it("rejects scripts as array", () => {
		const errors = validateManifest({
			name: "test-mod",
			scripts: [{ steps: [{ tool: "shell" }] }],
		});
		expect(errors.some((e) => e.field === "scripts")).toBe(true);
	});

	it("rejects script step with null input", () => {
		const errors = validateManifest({
			name: "test-mod",
			scripts: {
				"bad-null": { steps: [{ tool: "shell", input: null }] },
			},
		});
		expect(errors.some((e) => e.field.includes("input"))).toBe(true);
	});

	it("rejects script step with array input", () => {
		const errors = validateManifest({
			name: "test-mod",
			scripts: {
				"bad-arr": { steps: [{ tool: "shell", input: [1, 2] }] },
			},
		});
		expect(errors.some((e) => e.field.includes("input"))).toBe(true);
	});

	it("accepts name at exactly 3 characters", () => {
		const errors = validateManifest({ name: "abc" });
		expect(errors).toHaveLength(0);
	});

	it("rejects name at exactly 1 character", () => {
		const errors = validateManifest({ name: "x" });
		expect(errors.some((e) => e.field === "name")).toBe(true);
	});

	it("rejects name with uppercase letters", () => {
		const errors = validateManifest({ name: "MyModule" });
		expect(errors.some((e) => e.field === "name")).toBe(true);
	});

	it("rejects name starting with digit", () => {
		const errors = validateManifest({ name: "1bad-name" });
		expect(errors.some((e) => e.field === "name")).toBe(true);
	});

	it("rejects name ending with hyphen", () => {
		const errors = validateManifest({ name: "bad-" });
		expect(errors.some((e) => e.field === "name")).toBe(true);
	});

	it("validates all builtin module name conflicts", () => {
		const builtins = [
			"working-memory", "secrets", "memory", "knowledge",
			"scheduler", "telegram", "daemon", "vercel-adapter", "web", "registry",
		];
		for (const name of builtins) {
			const errors = validateManifest({ name });
			expect(errors.some((e) => e.message.includes("built-in")), `${name} should conflict`).toBe(true);
		}
	});

	it("rejects event handler step with null as entry", () => {
		const errors = validateManifest({
			name: "test-mod",
			eventHandlers: [{
				event: "test",
				steps: [null],
			}],
		});
		expect(errors.some((e) => e.message === "each step must be an object")).toBe(true);
	});
});
