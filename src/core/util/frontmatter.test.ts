import { describe, expect, it } from "vitest";
import {
	parseFlatFrontMatter,
	serializeFlatFrontMatter,
	splitFrontMatter,
} from "./frontmatter.js";

describe("splitFrontMatter", () => {
	it("returns null when no frontmatter delimiters present", () => {
		expect(splitFrontMatter("just body text")).toBeNull();
	});

	it("returns null for malformed frontmatter (missing closing ---)", () => {
		expect(splitFrontMatter("---\nkey: val\n")).toBeNull();
	});

	it("splits valid frontmatter from body", () => {
		const raw = "---\nkey: val\n---\nbody text";
		const result = splitFrontMatter(raw);
		expect(result).not.toBeNull();
		expect(result!.frontmatter).toBe("key: val");
		expect(result!.body).toBe("body text");
	});

	it("handles CRLF line endings", () => {
		const raw = "---\r\nkey: val\r\n---\r\nbody text";
		const result = splitFrontMatter(raw);
		expect(result).not.toBeNull();
		expect(result!.frontmatter).toBe("key: val");
		expect(result!.body).toBe("body text");
	});

	it("handles empty body", () => {
		const raw = "---\nkey: val\n---\n";
		const result = splitFrontMatter(raw);
		expect(result).not.toBeNull();
		expect(result!.body).toBe("");
	});

	it("handles empty frontmatter block", () => {
		const raw = "---\n\n---\nbody";
		const result = splitFrontMatter(raw);
		expect(result).not.toBeNull();
		expect(result!.frontmatter).toBe("");
		expect(result!.body).toBe("body");
	});
});

describe("parseFlatFrontMatter", () => {
	it("returns empty attrs and raw string when no frontmatter", () => {
		const result = parseFlatFrontMatter("no frontmatter");
		expect(result.attrs).toEqual({});
		expect(result.body).toBe("no frontmatter");
	});

	it("parses simple key-value pairs", () => {
		const raw = "---\ntitle: Hello\nstatus: doing\n---\nbody";
		const result = parseFlatFrontMatter(raw);
		expect(result.attrs).toEqual({ title: "Hello", status: "doing" });
		expect(result.body).toBe("body");
	});

	it("parses array-valued attributes", () => {
		const raw = "---\ntags: [a, b, c]\n---\nbody";
		const result = parseFlatFrontMatter(raw);
		expect(result.attrs.tags).toEqual(["a", "b", "c"]);
	});

	it("parses double-quoted scalars before array syntax", () => {
		const raw = "---\ntitle: \"[security]\"\nsummary: \"[a, b]\"\n---\nbody";
		const result = parseFlatFrontMatter(raw);
		expect(result.attrs).toEqual({ title: "[security]", summary: "[a, b]" });
	});

	it("handles CRLF line endings", () => {
		const raw = "---\r\ntitle: Hello\r\n---\r\nbody";
		const result = parseFlatFrontMatter(raw);
		expect(result.attrs).toEqual({ title: "Hello" });
	});

	it("skips comment lines in frontmatter", () => {
		const raw = "---\n# a comment\ntitle: Hi\n---\nbody";
		const result = parseFlatFrontMatter(raw);
		expect(result.attrs).toEqual({ title: "Hi" });
	});

	it("skips blank lines in frontmatter", () => {
		const raw = "---\n\ntitle: Hi\n\n---\nbody";
		const result = parseFlatFrontMatter(raw);
		expect(result.attrs).toEqual({ title: "Hi" });
	});

	it("handles empty body", () => {
		const raw = "---\ntitle: Hi\n---\n";
		const result = parseFlatFrontMatter(raw);
		expect(result.body).toBe("");
	});

	it("handles value with colon in it", () => {
		const raw = "---\nurl: http://example.com\n---\nbody";
		const result = parseFlatFrontMatter(raw);
		expect(result.attrs.url).toBe("http://example.com");
	});

	it("parses dotted and colon-namespaced keys", () => {
		const raw =
			"---\nproducer.version: v2\ngcp:semantic-type: fact-table\n---\nbody";
		const result = parseFlatFrontMatter(raw);
		expect(result.attrs["producer.version"]).toBe("v2");
		expect(result.attrs["gcp:semantic-type"]).toBe("fact-table");
	});
});

describe("serializeFlatFrontMatter", () => {
	it("serializes string attributes", () => {
		const result = serializeFlatFrontMatter({ title: "Hello", status: "done" }, "body");
		expect(result).toBe("---\ntitle: Hello\nstatus: done\n---\nbody");
	});

	it("serializes array attributes", () => {
		const result = serializeFlatFrontMatter({ tags: ["a", "b"] }, "body");
		expect(result).toBe("---\ntags: [a, b]\n---\nbody");
	});

	it("quotes string scalars that would otherwise parse as arrays", () => {
		const result = serializeFlatFrontMatter(
			{ title: "[security]", summary: "[a, b]" },
			"body",
		);
		expect(result).toBe("---\ntitle: \"[security]\"\nsummary: \"[a, b]\"\n---\nbody");
		expect(parseFlatFrontMatter(result).attrs).toEqual({
			title: "[security]",
			summary: "[a, b]",
		});
	});

	it("serializes empty body", () => {
		const result = serializeFlatFrontMatter({ title: "Hi" }, "");
		expect(result).toBe("---\ntitle: Hi\n---\n");
	});

	it("round-trips through parse and serialize", () => {
		const original = "---\ntitle: Hello\ntags: [a, b]\nstatus: doing\n---\nbody content";
		const parsed = parseFlatFrontMatter(original);
		const roundTripped = serializeFlatFrontMatter(parsed.attrs, parsed.body);
		expect(roundTripped).toBe(original);
	});

	it("round-trips namespaced keys", () => {
		const result = serializeFlatFrontMatter(
			{ "producer.version": "v2", "gcp:semantic-type": "fact-table" },
			"body",
		);
		const parsed = parseFlatFrontMatter(result);
		expect(parsed.attrs["producer.version"]).toBe("v2");
		expect(parsed.attrs["gcp:semantic-type"]).toBe("fact-table");
	});

	it("serializes empty attrs with bare delimiters", () => {
		const result = serializeFlatFrontMatter({}, "body only");
		expect(result).toBe("---\n---\nbody only");
	});
});
