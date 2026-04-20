import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	findInstructionFiles,
	loadInstructionContext,
	MAX_FILE_LENGTH,
	resolveReferences,
} from "./instruction-files.js";

const TEST_ROOT = join(process.cwd(), ".test-instruction-files");
const CHILD = join(TEST_ROOT, "subproject");
const GRANDCHILD = join(TEST_ROOT, "subproject", "deep");

beforeAll(() => {
	mkdirSync(GRANDCHILD, { recursive: true });
});

afterAll(() => {
	rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("resolveReferences", () => {
	it("resolves @path references to file content", () => {
		writeFileSync(join(TEST_ROOT, "rules.md"), "Rule 1: be kind", "utf-8");
		try {
			const result = resolveReferences("@rules.md", TEST_ROOT);
			expect(result).toBe("Rule 1: be kind");
		} finally {
			rmSync(join(TEST_ROOT, "rules.md"), { force: true });
		}
	});

	it("resolves nested references up to depth limit", () => {
		writeFileSync(join(TEST_ROOT, "a.md"), "@b.md", "utf-8");
		writeFileSync(join(TEST_ROOT, "b.md"), "leaf content", "utf-8");
		try {
			const result = resolveReferences("@a.md", TEST_ROOT);
			expect(result).toBe("leaf content");
		} finally {
			rmSync(join(TEST_ROOT, "a.md"), { force: true });
			rmSync(join(TEST_ROOT, "b.md"), { force: true });
		}
	});

	it("handles circular references gracefully", () => {
		writeFileSync(join(TEST_ROOT, "x.md"), "@y.md", "utf-8");
		writeFileSync(join(TEST_ROOT, "y.md"), "@x.md", "utf-8");
		try {
			const result = resolveReferences("@x.md", TEST_ROOT);
			expect(result).toContain("circular ref");
		} finally {
			rmSync(join(TEST_ROOT, "x.md"), { force: true });
			rmSync(join(TEST_ROOT, "y.md"), { force: true });
		}
	});

	it("comments out missing references", () => {
		const result = resolveReferences("@nonexistent.md", TEST_ROOT);
		expect(result).toContain("not found");
	});

	it("preserves non-reference content", () => {
		const input = "Line one\nsome text\nLine three";
		const result = resolveReferences(input, TEST_ROOT);
		expect(result).toBe(input);
	});

	it("resolves multiple references in one file", () => {
		writeFileSync(join(TEST_ROOT, "r1.md"), "rule one", "utf-8");
		writeFileSync(join(TEST_ROOT, "r2.md"), "rule two", "utf-8");
		try {
			const input = "Header\n@r1.md\nMiddle\n@r2.md\nFooter";
			const result = resolveReferences(input, TEST_ROOT);
			expect(result).toContain("rule one");
			expect(result).toContain("rule two");
			expect(result).toContain("Header");
			expect(result).toContain("Footer");
		} finally {
			rmSync(join(TEST_ROOT, "r1.md"), { force: true });
			rmSync(join(TEST_ROOT, "r2.md"), { force: true });
		}
	});

	it("skips empty referenced files", () => {
		writeFileSync(join(TEST_ROOT, "empty.md"), "", "utf-8");
		try {
			const result = resolveReferences("before\n@empty.md\nafter", TEST_ROOT);
			expect(result).toContain("before");
			expect(result).toContain("after");
		} finally {
			rmSync(join(TEST_ROOT, "empty.md"), { force: true });
		}
	});

	it("stops at MAX_REF_DEPTH=3", () => {
		writeFileSync(join(TEST_ROOT, "d1.md"), "@d2.md", "utf-8");
		writeFileSync(join(TEST_ROOT, "d2.md"), "@d3.md", "utf-8");
		writeFileSync(join(TEST_ROOT, "d3.md"), "@d4.md", "utf-8");
		writeFileSync(join(TEST_ROOT, "d4.md"), "deep leaf", "utf-8");
		try {
			// depth 0→d1, 1→d2, 2→d3, 3→stop (raw @d4.md returned)
			const result = resolveReferences("@d1.md", TEST_ROOT);
			expect(result).toContain("@d4.md");
		} finally {
			for (const f of ["d1.md", "d2.md", "d3.md", "d4.md"]) {
				rmSync(join(TEST_ROOT, f), { force: true });
			}
		}
	});
});

describe("findInstructionFiles", () => {
	it("finds AGENTS.md in start directory", () => {
		writeFileSync(join(TEST_ROOT, "AGENTS.md"), "agent rules", "utf-8");
		try {
			const files = findInstructionFiles(TEST_ROOT, TEST_ROOT);
			const match = files.find((f) => f.path === join(TEST_ROOT, "AGENTS.md"));
			expect(match).toBeDefined();
			expect(match!.content).toBe("agent rules");
			expect(match!.type).toBe("AGENTS");
		} finally {
			rmSync(join(TEST_ROOT, "AGENTS.md"), { force: true });
		}
	});

	it("finds CLAUDE.md in start directory", () => {
		writeFileSync(join(TEST_ROOT, "CLAUDE.md"), "claude rules", "utf-8");
		try {
			const files = findInstructionFiles(TEST_ROOT, TEST_ROOT);
			const match = files.find((f) => f.path === join(TEST_ROOT, "CLAUDE.md"));
			expect(match).toBeDefined();
			expect(match!.content).toBe("claude rules");
			expect(match!.type).toBe("CLAUDE");
		} finally {
			rmSync(join(TEST_ROOT, "CLAUDE.md"), { force: true });
		}
	});

	it("returns root-first ordering (outermost ancestor first)", () => {
		writeFileSync(join(TEST_ROOT, "AGENTS.md"), "parent agents", "utf-8");
		writeFileSync(join(CHILD, "AGENTS.md"), "child agents", "utf-8");
		try {
			const files = findInstructionFiles(CHILD, TEST_ROOT);
			const parentIdx = files.findIndex((f) => f.content === "parent agents");
			const childIdx = files.findIndex((f) => f.content === "child agents");
			expect(parentIdx).toBeGreaterThanOrEqual(0);
			expect(childIdx).toBeGreaterThan(parentIdx);
		} finally {
			rmSync(join(TEST_ROOT, "AGENTS.md"), { force: true });
			rmSync(join(CHILD, "AGENTS.md"), { force: true });
		}
	});

	it("finds both AGENTS.md and CLAUDE.md at same level", () => {
		writeFileSync(join(TEST_ROOT, "AGENTS.md"), "agents content", "utf-8");
		writeFileSync(join(TEST_ROOT, "CLAUDE.md"), "claude content", "utf-8");
		try {
			const files = findInstructionFiles(TEST_ROOT, TEST_ROOT);
			const agents = files.find(
				(f) => f.path === join(TEST_ROOT, "AGENTS.md"),
			);
			const claude = files.find(
				(f) => f.path === join(TEST_ROOT, "CLAUDE.md"),
			);
			expect(agents).toBeDefined();
			expect(claude).toBeDefined();
		} finally {
			rmSync(join(TEST_ROOT, "AGENTS.md"), { force: true });
			rmSync(join(TEST_ROOT, "CLAUDE.md"), { force: true });
		}
	});

	it("skips empty instruction files", () => {
		writeFileSync(join(TEST_ROOT, "AGENTS.md"), "", "utf-8");
		writeFileSync(join(TEST_ROOT, "CLAUDE.md"), "   ", "utf-8");
		try {
			const files = findInstructionFiles(TEST_ROOT, TEST_ROOT);
			const fromTestDirs = files.filter((f) => f.path.startsWith(TEST_ROOT));
			expect(fromTestDirs).toHaveLength(0);
		} finally {
			rmSync(join(TEST_ROOT, "AGENTS.md"), { force: true });
			rmSync(join(TEST_ROOT, "CLAUDE.md"), { force: true });
		}
	});

	it("resolves @references in discovered files", () => {
		writeFileSync(join(TEST_ROOT, "CLAUDE.md"), "@AGENTS.md", "utf-8");
		writeFileSync(join(TEST_ROOT, "AGENTS.md"), "shared rules", "utf-8");
		try {
			const files = findInstructionFiles(TEST_ROOT, TEST_ROOT);
			const claude = files.find(
				(f) => f.path === join(TEST_ROOT, "CLAUDE.md"),
			);
			expect(claude).toBeDefined();
			expect(claude!.content).toBe("shared rules");
		} finally {
			rmSync(join(TEST_ROOT, "CLAUDE.md"), { force: true });
			rmSync(join(TEST_ROOT, "AGENTS.md"), { force: true });
		}
	});

	it("returns empty array when no instruction files exist", () => {
		const files = findInstructionFiles(GRANDCHILD, TEST_ROOT);
		expect(files).toHaveLength(0);
	});

	it("supports repo-style root AGENTS that reference docs files", () => {
		mkdirSync(join(TEST_ROOT, "docs"), { recursive: true });
		mkdirSync(join(TEST_ROOT, "data", "tasks"), { recursive: true });
		writeFileSync(
			join(TEST_ROOT, "AGENTS.md"),
			"# Root\n\n@docs/STANDARDS.md\n\n@data/tasks/AGENTS.md",
			"utf-8",
		);
		writeFileSync(
			join(TEST_ROOT, "docs", "STANDARDS.md"),
			"standards rules",
			"utf-8",
		);
		writeFileSync(
			join(TEST_ROOT, "data", "tasks", "AGENTS.md"),
			"task rules",
			"utf-8",
		);
		try {
			const files = findInstructionFiles(CHILD, TEST_ROOT);
			const root = files.find((f) => f.path === join(TEST_ROOT, "AGENTS.md"));
			expect(root).toBeDefined();
			expect(root!.content).toContain("standards rules");
			expect(root!.content).toContain("task rules");
		} finally {
			rmSync(join(TEST_ROOT, "AGENTS.md"), { force: true });
			rmSync(join(TEST_ROOT, "docs"), { recursive: true, force: true });
			rmSync(join(TEST_ROOT, "data"), { recursive: true, force: true });
		}
	});

	it("does not climb above the declared repo root", () => {
		writeFileSync(join(TEST_ROOT, "AGENTS.md"), "repo rules", "utf-8");
		try {
			const files = findInstructionFiles(CHILD, TEST_ROOT);
			expect(files.map((file) => file.path)).toEqual([
				join(TEST_ROOT, "AGENTS.md"),
			]);
		} finally {
			rmSync(join(TEST_ROOT, "AGENTS.md"), { force: true });
		}
	});
});

describe("loadInstructionContext", () => {
	it("returns empty string when no files found", () => {
		const result = loadInstructionContext(GRANDCHILD, TEST_ROOT);
		expect(result).toBe("");
	});

	it("truncates a single physical file exceeding 8000 chars", () => {
		const longContent = "x".repeat(9000);
		writeFileSync(join(TEST_ROOT, "AGENTS.md"), longContent, "utf-8");
		try {
			const result = loadInstructionContext(TEST_ROOT, TEST_ROOT);
			expect(result).toContain("... (truncated)");
		} finally {
			rmSync(join(TEST_ROOT, "AGENTS.md"), { force: true });
		}
	});

	it("does not truncate aggregated @-expanded content when each leaf file is small", () => {
		mkdirSync(join(TEST_ROOT, "docs"), { recursive: true });
		writeFileSync(
			join(TEST_ROOT, "AGENTS.md"),
			"# Root\n\n@docs/A.md\n\n@docs/B.md\n\n@docs/C.md",
			"utf-8",
		);
		writeFileSync(join(TEST_ROOT, "docs", "A.md"), "a".repeat(5000), "utf-8");
		writeFileSync(join(TEST_ROOT, "docs", "B.md"), "b".repeat(5000), "utf-8");
		writeFileSync(join(TEST_ROOT, "docs", "C.md"), "c".repeat(5000), "utf-8");
		try {
			const result = loadInstructionContext(TEST_ROOT, TEST_ROOT);
			expect(result).not.toContain("... (truncated)");
			expect(result).toContain("a".repeat(5000));
			expect(result).toContain("b".repeat(5000));
			expect(result).toContain("c".repeat(5000));
		} finally {
			rmSync(join(TEST_ROOT, "AGENTS.md"), { force: true });
			rmSync(join(TEST_ROOT, "docs"), { recursive: true, force: true });
		}
	});

	it("truncates a large @-referenced leaf file at its own 8000-char cap", () => {
		mkdirSync(join(TEST_ROOT, "docs"), { recursive: true });
		writeFileSync(join(TEST_ROOT, "AGENTS.md"), "@docs/HUGE.md", "utf-8");
		writeFileSync(
			join(TEST_ROOT, "docs", "HUGE.md"),
			"h".repeat(12_000),
			"utf-8",
		);
		try {
			const result = loadInstructionContext(TEST_ROOT, TEST_ROOT);
			expect(result).toContain("... (truncated)");
			expect((result.match(/h/g) ?? []).length).toBe(8_000);
		} finally {
			rmSync(join(TEST_ROOT, "AGENTS.md"), { force: true });
			rmSync(join(TEST_ROOT, "docs"), { recursive: true, force: true });
		}
	});

	it("formats output with section headers and type labels", () => {
		writeFileSync(join(TEST_ROOT, "AGENTS.md"), "agent rules", "utf-8");
		writeFileSync(join(CHILD, "CLAUDE.md"), "claude rules", "utf-8");
		try {
			const result = loadInstructionContext(CHILD, TEST_ROOT);
			expect(result).toContain("## Project Instructions");
			expect(result).toContain("AGENTS:");
			expect(result).toContain("CLAUDE:");
			expect(result).toContain("agent rules");
			expect(result).toContain("claude rules");
		} finally {
			rmSync(join(TEST_ROOT, "AGENTS.md"), { force: true });
			rmSync(join(CHILD, "CLAUDE.md"), { force: true });
		}
	});

	it("includes separator between multiple files", () => {
		writeFileSync(join(TEST_ROOT, "AGENTS.md"), "root rules", "utf-8");
		writeFileSync(join(CHILD, "AGENTS.md"), "child rules", "utf-8");
		try {
			const result = loadInstructionContext(CHILD, TEST_ROOT);
			expect(result).toContain("---");
		} finally {
			rmSync(join(TEST_ROOT, "AGENTS.md"), { force: true });
			rmSync(join(CHILD, "AGENTS.md"), { force: true });
		}
	});
});

// Load-bearing rules at the bottom of an oversized instruction file are
// silently truncated from every agent's system prompt (a 2026-04-19 builder
// failure traced a direct-commit breach to exactly this). Enforce the cap as
// a stable repo invariant so future growth fails loudly instead.
describe("repo instruction files stay under the injection cap", () => {
	const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
		cwd: import.meta.dirname,
		encoding: "utf-8",
	}).trim();

	const tracked = execFileSync(
		"git",
		["ls-files", "--", "*AGENTS.md", "*CLAUDE.md"],
		{ cwd: repoRoot, encoding: "utf-8" },
	)
		.split("\n")
		.filter(Boolean)
		.map((rel) => join(repoRoot, rel));

	it("finds the expected instruction files", () => {
		expect(tracked.length).toBeGreaterThan(0);
	});

	for (const path of tracked) {
		it(`${path.slice(repoRoot.length + 1)} stays under ${MAX_FILE_LENGTH} bytes`, () => {
			const size = statSync(path).size;
			expect(size, `${path} is ${size} bytes; truncation hides trailing rules`).toBeLessThanOrEqual(MAX_FILE_LENGTH);
		});
	}
});
