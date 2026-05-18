import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModuleLoader } from "./module-loader.js";

function writeProjectFile(root: string, relPath: string, content: string): void {
	const fullPath = join(root, relPath);
	mkdirSync(dirname(fullPath), { recursive: true });
	writeFileSync(fullPath, content);
}

function writeImportedSkill(
	root: string,
	fileName: string,
	frontmatter: string,
	body: string,
): void {
	writeProjectFile(root, join(".kota", "skills", fileName), `---\n${frontmatter}---\n${body}`);
}

describe("imported skill resolution", () => {
	let projectDir: string;
	let loader: ModuleLoader;

	beforeEach(() => {
		projectDir = mkdtempSync(join(tmpdir(), "kota-imported-skills-"));
		loader = new ModuleLoader({});
		loader.setCwd(projectDir);
	});

	afterEach(() => {
		rmSync(projectDir, { recursive: true, force: true });
	});

	it("injects explicitly named imported skills but excludes them from skills all", async () => {
		writeProjectFile(projectDir, "module.md", "Module guidance.");
		writeImportedSkill(
			projectDir,
			"review.md",
			"name: review\nimported_from: https://example.com/review.md\n",
			"Imported review guidance.",
		);
		await loader.load({
			name: "module-skills",
			skills: [{ name: "module", promptPath: "module.md" }],
		});

		const explicitPrompt = loader.getSkillsPromptFor(["review"], "builder");
		expect(explicitPrompt).toContain("### review");
		expect(explicitPrompt).toContain("Imported review guidance.");

		const allPrompt = loader.getSkillsPromptFor("all", "builder");
		expect(allPrompt).toContain("### module");
		expect(allPrompt).not.toContain("### review");

		const unrelatedPrompt = loader.getSkillsPromptFor(["module"], "builder");
		expect(unrelatedPrompt).not.toContain("Imported review guidance.");
	});

	it("injects a pack-imported selected skill only when named explicitly", async () => {
		writeImportedSkill(
			projectDir,
			"typescript.md",
			"name: typescript\nimported_from: repo-pack: vercel/ai -> typescript/SKILL.md (skill: typescript)\n",
			"Pack-imported TypeScript guidance.",
		);
		await loader.load({ name: "empty-module" });

		expect(loader.getSkillsPromptFor(["typescript"], "builder")).toContain(
			"Pack-imported TypeScript guidance.",
		);
		expect(loader.getSkillsPromptFor("all", "builder")).not.toContain(
			"Pack-imported TypeScript guidance.",
		);
	});

	it("keeps module-contributed skills ahead of imported name collisions", async () => {
		writeProjectFile(projectDir, "shared.md", "Module shared guidance.");
		writeImportedSkill(
			projectDir,
			"shared-imported.md",
			"name: shared\n",
			"Imported shared guidance.",
		);
		await loader.load({
			name: "module-skills",
			skills: [{ name: "shared", promptPath: "shared.md" }],
		});

		const prompt = loader.getSkillsPromptFor(["shared"], "builder");
		expect(prompt).toContain("Module shared guidance.");
		expect(prompt).not.toContain("Imported shared guidance.");
	});

	it("applies role filtering to explicitly selected imported skills", async () => {
		writeImportedSkill(
			projectDir,
			"builder-only.md",
			"name: builder-only\nroles: [builder]\n",
			"Builder imported guidance.",
		);
		await loader.load({ name: "empty-module" });

		expect(loader.getSkillsPromptFor(["builder-only"], "builder")).toContain(
			"Builder imported guidance.",
		);
		expect(loader.getSkillsPromptFor(["builder-only"], "explorer")).not.toContain(
			"Builder imported guidance.",
		);
	});

	it("fails loudly on malformed or duplicate imported skill data", async () => {
		writeImportedSkill(projectDir, "one.md", "name: duplicate\n", "One.");
		writeImportedSkill(projectDir, "two.md", "name: duplicate\n", "Two.");
		await loader.load({ name: "empty-module" });

		expect(() => loader.getSkillsPromptFor(["duplicate"], "builder")).toThrow(
			'duplicate imported skill name "duplicate"',
		);
	});
});
