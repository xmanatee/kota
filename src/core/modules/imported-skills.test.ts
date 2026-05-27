import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IMPORTED_SKILL_PROVENANCE_FILE } from "./imported-skills.js";
import { ModuleLoader } from "./module-loader.js";

function writeProjectFile(root: string, relPath: string, content: string): void {
	const fullPath = join(root, relPath);
	mkdirSync(dirname(fullPath), { recursive: true });
	writeFileSync(fullPath, content);
}

function writeImportedSkill(
	root: string,
	name: string,
	frontmatter: string,
	body: string,
): void {
	writeProjectFile(root, join(".kota", "skills", name, "SKILL.md"), `---\n${frontmatter}---\n${body}`);
	writeProjectFile(
		root,
		join(".kota", "skills", name, IMPORTED_SKILL_PROVENANCE_FILE),
		`${JSON.stringify({
			version: 1,
			skillName: name,
			source: `/source/${name}`,
			sourceKind: "single-file",
			selectedSkillPath: `/source/${name}/SKILL.md`,
			provenance: `/source/${name}`,
			importedFiles: ["SKILL.md"],
			skippedFiles: [],
		}, null, 2)}\n`,
	);
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
			"review",
			"name: review\nimported_from: https://example.com/review.md\n",
			"Imported review guidance.",
		);
		await loader.load({
			name: "module-skills",
			skills: [{ name: "module", promptPath: "module.md" }],
		});

		const explicitPrompt = loader.getSkillsPromptFor(["review"], "builder");
		expect(explicitPrompt).toContain("### review");
		expect(explicitPrompt).toContain("Imported skill directory: .kota/skills/review");
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
			"typescript",
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
			"shared",
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
			"builder-only",
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

	it("rejects imported skill frontmatter tool-policy declarations before prompt resolution", async () => {
		writeImportedSkill(
			projectDir,
			"restricted",
			"name: restricted\ndisallowed-tools: [Bash]\n",
			"Restricted imported guidance.",
		);
		await loader.load({ name: "empty-module" });

		expect(() => loader.getSkillsPromptFor(["restricted"], "builder")).toThrow(
			'.kota/skills/restricted/SKILL.md: unsupported skill tool-policy frontmatter "disallowed-tools"',
		);
	});

	it("fails loudly on malformed or duplicate imported skill data", async () => {
		writeImportedSkill(projectDir, "one", "name: duplicate\n", "One.");
		writeImportedSkill(projectDir, "two", "name: duplicate\n", "Two.");
		await loader.load({ name: "empty-module" });

		expect(() => loader.getSkillsPromptFor(["duplicate"], "builder")).toThrow(
			'frontmatter "name" must match imported skill directory "one"',
		);
	});

	it("fails loudly on legacy flat imported skill files", async () => {
		writeProjectFile(
			projectDir,
			join(".kota", "skills", "legacy.md"),
			"---\nname: legacy\n---\nLegacy guidance.",
		);
		await loader.load({ name: "empty-module" });

		expect(() => loader.getSkillsPromptFor(["legacy"], "builder")).toThrow(
			"legacy flat imported skill files are no longer loaded",
		);
	});

	it("rejects path-escaping imported resource metadata", async () => {
		writeProjectFile(
			projectDir,
			join(".kota", "skills", "escape", "SKILL.md"),
			"---\nname: escape\n---\nEscape guidance.",
		);
		writeProjectFile(
			projectDir,
			join(".kota", "skills", "escape", IMPORTED_SKILL_PROVENANCE_FILE),
			`${JSON.stringify({
				version: 1,
				skillName: "escape",
				source: "/source/escape",
				sourceKind: "skill-directory",
				selectedSkillPath: "/source/escape/SKILL.md",
				provenance: "/source/escape",
				importedFiles: ["SKILL.md", "../outside.md"],
				skippedFiles: [],
			}, null, 2)}\n`,
		);
		await loader.load({ name: "empty-module" });

		expect(() => loader.getSkillsPromptFor(["escape"], "builder")).toThrow(
			'path "../outside.md" escapes the imported skill directory',
		);
	});
});
