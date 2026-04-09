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
		});
		expect(errors.length).toBeGreaterThanOrEqual(2);
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

	it("validates all reserved module name conflicts", () => {
		const reservedNames = [
			"working-memory", "secrets", "memory", "knowledge",
			"scheduler", "telegram", "daemon", "vercel-adapter", "web", "registry",
		];
		for (const name of reservedNames) {
			const errors = validateManifest({ name });
			expect(errors.some((e) => e.message.includes("project module")), `${name} should conflict`).toBe(true);
		}
	});

});
