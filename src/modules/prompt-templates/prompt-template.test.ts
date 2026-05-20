import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	extractVariables,
	PromptStore,
	PromptTemplateParseError,
	parseFrontMatter,
	renderTemplate,
	serializeFrontMatter,
} from "./prompt-template.js";

// --- parseFrontMatter ---

describe("parseFrontMatter", () => {
	it("parses standard front matter", () => {
		const raw = "---\nname: test\ndescription: A test\n---\nBody here";
		const { attrs, body } = parseFrontMatter(raw);
		expect(attrs.name).toBe("test");
		expect(attrs.description).toBe("A test");
		expect(body).toBe("Body here");
	});

	it("parses array values in brackets", () => {
		const raw = "---\nvariables: [lang, focus]\ntags: [code, review]\n---\nBody";
		const { attrs } = parseFrontMatter(raw);
		expect(attrs.variables).toEqual(["lang", "focus"]);
		expect(attrs.tags).toEqual(["code", "review"]);
	});

	it("returns raw body when no front matter", () => {
		const raw = "No front matter here";
		const { attrs, body } = parseFrontMatter(raw);
		expect(attrs).toEqual({});
		expect(body).toBe("No front matter here");
	});

	it("handles empty front matter", () => {
		const raw = "---\n\n---\nBody only";
		const { attrs, body } = parseFrontMatter(raw);
		expect(attrs).toEqual({});
		expect(body).toBe("Body only");
	});

	it("ignores comment lines in front matter", () => {
		const raw = "---\nname: test\n# This is a comment\n---\nBody";
		const { attrs } = parseFrontMatter(raw);
		expect(attrs.name).toBe("test");
		expect(attrs["# This is a comment"]).toBeUndefined();
	});
});

// --- serializeFrontMatter ---

describe("serializeFrontMatter", () => {
	it("serializes scalar attributes", () => {
		const result = serializeFrontMatter({ name: "test", description: "A test" }, "Body");
		expect(result).toBe("---\nname: test\ndescription: A test\n---\nBody");
	});

	it("serializes array attributes", () => {
		const result = serializeFrontMatter({ variables: ["a", "b"] }, "Body");
		expect(result).toBe("---\nvariables: [a, b]\n---\nBody");
	});

	it("round-trips with parseFrontMatter", () => {
		const original = { name: "round-trip", tags: ["x", "y"] };
		const body = "Template body";
		const serialized = serializeFrontMatter(original, body);
		const { attrs, body: parsedBody } = parseFrontMatter(serialized);
		expect(attrs.name).toBe("round-trip");
		expect(attrs.tags).toEqual(["x", "y"]);
		expect(parsedBody).toBe("Template body");
	});
});

// --- renderTemplate ---

describe("renderTemplate", () => {
	it("substitutes variables", () => {
		const result = renderTemplate("Hello {{name}}, welcome to {{place}}!", {
			name: "Alice",
			place: "Wonderland",
		});
		expect(result).toBe("Hello Alice, welcome to Wonderland!");
	});

	it("leaves unmatched placeholders intact", () => {
		const result = renderTemplate("{{greeting}} {{name}}", { greeting: "Hi" });
		expect(result).toBe("Hi {{name}}");
	});

	it("handles empty vars", () => {
		const result = renderTemplate("No vars here", {});
		expect(result).toBe("No vars here");
	});

	it("handles multiple occurrences of same variable", () => {
		const result = renderTemplate("{{x}} and {{x}}", { x: "val" });
		expect(result).toBe("val and val");
	});

	it("handles empty string substitution", () => {
		const result = renderTemplate("before {{x}} after", { x: "" });
		expect(result).toBe("before  after");
	});
});

// --- extractVariables ---

describe("extractVariables", () => {
	it("extracts unique variable names", () => {
		const vars = extractVariables("{{a}} {{b}} {{a}} {{c}}");
		expect(vars).toEqual(["a", "b", "c"]);
	});

	it("returns empty array for no variables", () => {
		expect(extractVariables("No variables")).toEqual([]);
	});

	it("handles adjacent variables", () => {
		const vars = extractVariables("{{x}}{{y}}");
		expect(vars).toEqual(["x", "y"]);
	});
});

// --- PromptStore ---

describe("PromptStore", () => {
	let dir: string;

	afterEach(() => {
		// Cleanup handled by OS temp dir
	});

	function setup(): PromptStore {
		dir = mkdtempSync(join(tmpdir(), "prompt-store-"));
		const promptsDir = join(dir, ".kota", "prompts");
		mkdirSync(promptsDir, { recursive: true });
		return new PromptStore(dir);
	}

	function writeTemplate(name: string, content: string): void {
		writeFileSync(join(dir, ".kota", "prompts", `${name}.md`), content, "utf-8");
	}

	it("discovers templates from directory", () => {
		const store = setup();
		writeTemplate("greet", "---\nname: greet\ndescription: Greeting prompt\nvariables: [name]\n---\nHello {{name}}!");
		const count = store.discover();
		expect(count).toBe(1);
		expect(store.size).toBe(1);
	});

	it("returns 0 when directory doesn't exist", () => {
		const emptyDir = mkdtempSync(join(tmpdir(), "prompt-empty-"));
		const store = new PromptStore(emptyDir);
		expect(store.discover()).toBe(0);
		expect(store.size).toBe(0);
	});

	it("ignores files without name in front matter", () => {
		const store = setup();
		writeTemplate("bad", "---\ndescription: no name\n---\nBody");
		expect(store.discover()).toBe(0);
	});

	it("rejects non-string names in front matter", () => {
		const store = setup();
		writeTemplate("bad", "---\nname: [bad]\n---\nBody");
		expect(() => store.discover()).toThrow(PromptTemplateParseError);
		expect(() => store.discover()).toThrow('front matter "name" must be a string');
	});

	it("ignores non-md files", () => {
		const store = setup();
		writeFileSync(join(dir, ".kota", "prompts", "notes.txt"), "not a template", "utf-8");
		writeTemplate("valid", "---\nname: valid\n---\nBody");
		expect(store.discover()).toBe(1);
	});

	it("get returns template by name", () => {
		const store = setup();
		writeTemplate("test", "---\nname: test\ndescription: Test prompt\n---\nBody content");
		store.discover();
		const tpl = store.get("test");
		expect(tpl).toBeDefined();
		expect(tpl!.name).toBe("test");
		expect(tpl!.body).toBe("Body content");
	});

	it("get returns undefined for missing template", () => {
		const store = setup();
		store.discover();
		expect(store.get("nonexistent")).toBeUndefined();
	});

	it("list returns metadata for all templates", () => {
		const store = setup();
		writeTemplate("a", "---\nname: alpha\ndescription: First\ntags: [x]\nvariables: [v1]\n---\nBody A");
		writeTemplate("b", "---\nname: beta\n---\nBody B with {{v2}}");
		store.discover();
		const list = store.list();
		expect(list).toHaveLength(2);
		const names = list.map((t) => t.name).sort();
		expect(names).toEqual(["alpha", "beta"]);
	});

	it("render substitutes variables", () => {
		const store = setup();
		writeTemplate("greet", "---\nname: greet\nvariables: [name, role]\n---\nHello {{name}}, you are a {{role}}.");
		store.discover();
		const result = store.render("greet", { name: "Bob", role: "developer" });
		expect(result).not.toBeNull();
		expect(result!.content).toBe("Hello Bob, you are a developer.");
		expect(result!.missing).toEqual([]);
	});

	it("render reports missing variables", () => {
		const store = setup();
		writeTemplate("partial", "---\nname: partial\nvariables: [a, b, c]\n---\n{{a}} {{b}} {{c}}");
		store.discover();
		const result = store.render("partial", { a: "X" });
		expect(result!.content).toBe("X {{b}} {{c}}");
		expect(result!.missing).toEqual(["b", "c"]);
	});

	it("render returns null for missing template", () => {
		const store = setup();
		store.discover();
		expect(store.render("nope", {})).toBeNull();
	});

	it("create writes a new template file", () => {
		const store = setup();
		const filePath = store.create(
			{ name: "new-prompt", description: "A new prompt", variables: ["x"], tags: ["test"] },
			"Content with {{x}}",
		);
		expect(filePath).toContain("new-prompt.md");
		const raw = readFileSync(filePath, "utf-8");
		expect(raw).toContain("name: new-prompt");
		expect(raw).toContain("Content with {{x}}");
	});

	it("create makes template immediately available", () => {
		const store = setup();
		store.create({ name: "instant" }, "Instant body");
		const tpl = store.get("instant");
		expect(tpl).toBeDefined();
		expect(tpl!.body).toBe("Instant body");
	});

	it("create auto-creates prompts directory", () => {
		const emptyDir = mkdtempSync(join(tmpdir(), "prompt-no-dir-"));
		const store = new PromptStore(emptyDir);
		const filePath = store.create({ name: "auto-dir" }, "Body");
		expect(filePath).toContain("auto-dir.md");
	});

	it("auto-detects variables when not declared in front matter", () => {
		const store = setup();
		writeTemplate("auto", "---\nname: auto-vars\n---\nHello {{who}} from {{where}}");
		store.discover();
		const tpl = store.get("auto-vars");
		expect(tpl!.variables).toEqual(["who", "where"]);
	});

	it("delete removes template", () => {
		const store = setup();
		store.create({ name: "deleteme" }, "Temporary");
		expect(store.get("deleteme")).toBeDefined();
		const deleted = store.delete("deleteme");
		expect(deleted).toBe(true);
		expect(store.get("deleteme")).toBeUndefined();
	});

	it("delete returns false for missing template", () => {
		const store = setup();
		expect(store.delete("ghost")).toBe(false);
	});
});
