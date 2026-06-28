import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	OkfBundleError,
	readOkfBundle,
	validateOkfBundle,
} from "./okf.js";

describe("OKF bundle validation", () => {
	let tempDir: string;
	let bundleDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "kota-okf-"));
		bundleDir = join(tempDir, "bundle");
		mkdirSync(bundleDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("accepts nested concepts, reserved index/log files, and local markdown links", () => {
		writeFileSync(
			join(bundleDir, "index.md"),
			'---\nokf_version: "0.1"\n---\n# Bundle\n',
			"utf-8",
		);
		writeFileSync(join(bundleDir, "log.md"), "# Directory Update Log\n\n## 2026-06-28\n* **Creation**: Initial.\n", "utf-8");
		mkdirSync(join(bundleDir, "tables"), { recursive: true });
		writeFileSync(join(bundleDir, "tables", "index.md"), "# Tables\n", "utf-8");
		writeFileSync(
			join(bundleDir, "tables", "orders.md"),
			[
				"---",
				"type: BigQuery Table",
				"title: Orders",
				"description: Order facts.",
				"resource: https://example.test/orders",
				"tags: [sales, orders]",
				"timestamp: 2026-06-28T00:00:00Z",
				"owner: data",
				"---",
				"Part of [customers](/tables/customers.md).",
				"",
			].join("\n"),
			"utf-8",
		);
		writeFileSync(
			join(bundleDir, "tables", "customers.md"),
			"---\ntype: BigQuery Table\ntitle: Customers\n---\nCustomer dimension.\n",
			"utf-8",
		);

		const result = validateOkfBundle(bundleDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.bundle.okfVersion).toBe("0.1");
		expect(result.bundle.concepts.map((concept) => concept.conceptId).sort()).toEqual([
			"tables/customers",
			"tables/orders",
		]);
		const orders = result.bundle.concepts.find((concept) => concept.conceptId === "tables/orders");
		expect(orders?.localLinks).toEqual(["tables/customers"]);
	});

	it("reports malformed frontmatter, missing type, reserved-file misuse, and traversal links", () => {
		writeFileSync(join(bundleDir, "bad.md"), "---\ntitle Only\n---\nBody\n", "utf-8");
		writeFileSync(join(bundleDir, "missing-type.md"), "---\ntitle: Missing\n---\nBody\n", "utf-8");
		mkdirSync(join(bundleDir, "nested"), { recursive: true });
		writeFileSync(join(bundleDir, "nested", "index.md"), "---\ntype: Wrong\n---\n# Bad\n", "utf-8");
		writeFileSync(
			join(bundleDir, "link.md"),
			"---\ntype: Reference\n---\n[escape](../outside.md)\n",
			"utf-8",
		);

		const result = validateOkfBundle(bundleDir);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		const messages = result.errors.map((issue) => issue.message).join("\n");
		expect(messages).toContain("malformed frontmatter");
		expect(messages).toContain('requires non-empty "type"');
		expect(messages).toContain("index.md frontmatter is only supported");
		expect(messages).toContain("local markdown link escapes the bundle");
	});

	it("rejects unterminated quoted scalar frontmatter values", () => {
		writeFileSync(
			join(bundleDir, "bad-title.md"),
			"---\ntype: Reference\ntitle: \"Unclosed\n---\nBody\n",
			"utf-8",
		);
		writeFileSync(
			join(bundleDir, "bad-tags.md"),
			"---\ntype: Reference\ntags: [stable, \"unclosed]\n---\nBody\n",
			"utf-8",
		);

		const result = validateOkfBundle(bundleDir);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "bad-tags.md",
					message: "malformed frontmatter quoted scalar on line 2",
				}),
				expect.objectContaining({
					path: "bad-title.md",
					message: "malformed frontmatter quoted scalar on line 2",
				}),
			]),
		);
		expect(() => readOkfBundle(bundleDir)).toThrow(OkfBundleError);
	});

	it("rejects symlink traversal", () => {
		const outside = join(tempDir, "outside.md");
		writeFileSync(outside, "---\ntype: Reference\n---\noutside\n", "utf-8");
		symlinkSync(outside, join(bundleDir, "outside.md"));

		const result = validateOkfBundle(bundleDir);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors[0]?.message).toContain("symbolic links are not supported");
	});
});
