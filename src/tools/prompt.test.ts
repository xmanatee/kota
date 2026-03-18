import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptStore } from "../prompt-template.js";
import { resetPromptStore, runPromptTemplate, setPromptStore } from "./prompt.js";

describe("prompt_template tool", () => {
	let dir: string;

	function setupStore(): PromptStore {
		dir = mkdtempSync(join(tmpdir(), "prompt-tool-"));
		const promptsDir = join(dir, ".kota", "prompts");
		mkdirSync(promptsDir, { recursive: true });
		const store = new PromptStore(dir);
		setPromptStore(store);
		return store;
	}

	function writeTemplate(name: string, content: string): void {
		writeFileSync(join(dir, ".kota", "prompts", `${name}.md`), content, "utf-8");
	}

	afterEach(() => {
		resetPromptStore();
		vi.restoreAllMocks();
	});

	// --- list ---

	it("list returns empty message when no templates", async () => {
		setupStore();
		const result = await runPromptTemplate({ action: "list" });
		expect(result.content).toContain("No prompt templates found");
	});

	it("list returns template summaries", async () => {
		setupStore();
		writeTemplate("a", "---\nname: alpha\ndescription: First template\nvariables: [x]\ntags: [test]\n---\nBody");
		writeTemplate("b", "---\nname: beta\n---\nBody with {{y}}");
		const result = await runPromptTemplate({ action: "list" });
		expect(result.content).toContain("2 templates");
		expect(result.content).toContain("alpha");
		expect(result.content).toContain("beta");
		expect(result.content).toContain("vars: x");
	});

	// --- get ---

	it("get returns error without name", async () => {
		setupStore();
		const result = await runPromptTemplate({ action: "get" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("name is required");
	});

	it("get returns error for missing template", async () => {
		setupStore();
		const result = await runPromptTemplate({ action: "get", name: "nope" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("not found");
	});

	it("get returns template content", async () => {
		setupStore();
		writeTemplate("info", "---\nname: info\ndescription: Info prompt\nvariables: [topic]\ntags: [research]\n---\nResearch {{topic}} thoroughly.");
		const result = await runPromptTemplate({ action: "get", name: "info" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("## info");
		expect(result.content).toContain("description: Info prompt");
		expect(result.content).toContain("Research {{topic}} thoroughly.");
	});

	// --- render ---

	it("render returns error without name", async () => {
		setupStore();
		const result = await runPromptTemplate({ action: "render" });
		expect(result.is_error).toBe(true);
	});

	it("render returns error for missing template", async () => {
		setupStore();
		const result = await runPromptTemplate({ action: "render", name: "ghost" });
		expect(result.is_error).toBe(true);
	});

	it("render substitutes variables", async () => {
		setupStore();
		writeTemplate("greet", "---\nname: greet\nvariables: [name, role]\n---\nHello {{name}}, you are a {{role}}.");
		const result = await runPromptTemplate({
			action: "render",
			name: "greet",
			variables: { name: "Alice", role: "engineer" },
		});
		expect(result.content).toBe("Hello Alice, you are a engineer.");
	});

	it("render warns about missing variables", async () => {
		setupStore();
		writeTemplate("partial", "---\nname: partial\nvariables: [a, b]\n---\n{{a}} {{b}}");
		const result = await runPromptTemplate({
			action: "render",
			name: "partial",
			variables: { a: "X" },
		});
		expect(result.content).toContain("X {{b}}");
		expect(result.content).toContain("Unresolved variables: b");
	});

	// --- create ---

	it("create returns error without name or body", async () => {
		setupStore();
		const r1 = await runPromptTemplate({ action: "create" });
		expect(r1.is_error).toBe(true);
		const r2 = await runPromptTemplate({ action: "create", name: "test" });
		expect(r2.is_error).toBe(true);
	});

	it("create makes a new template", async () => {
		setupStore();
		const result = await runPromptTemplate({
			action: "create",
			name: "new-tpl",
			description: "A new template",
			body: "Content with {{var}}",
			tags: ["test"],
		});
		expect(result.content).toContain('Created template "new-tpl"');
		expect(result.content).toContain(".md");
	});

	it("created template is immediately loadable", async () => {
		setupStore();
		await runPromptTemplate({
			action: "create",
			name: "instant",
			body: "Hello {{who}}",
		});
		const result = await runPromptTemplate({
			action: "render",
			name: "instant",
			variables: { who: "World" },
		});
		expect(result.content).toBe("Hello World");
	});

	// --- unknown action ---

	it("returns error for unknown action", async () => {
		setupStore();
		const result = await runPromptTemplate({ action: "explode" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Unknown action");
	});
});
