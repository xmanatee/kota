import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MODULES_DIR = join(import.meta.dirname, "..", "..", "modules");

function listModuleDirs(): string[] {
  return readdirSync(MODULES_DIR).filter((name) => {
    const full = join(MODULES_DIR, name);
    return (
      statSync(full).isDirectory() && existsSync(join(full, "index.ts"))
    );
  });
}

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Eval-harness fixtures snapshot repo `.ts` sources via
    // `git show <commit>^:<path>` for replay, so their `initial/` trees
    // hide stale imports that are not part of the runtime module. Skip
    // them here the same way vitest `exclude` does.
    if (entry.isDirectory() && entry.name === "fixtures") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

type CrossModuleImport = {
  sourceModule: string;
  targetModule: string;
  file: string;
  typeOnly: boolean;
};

function findCrossModuleImports(moduleName: string): CrossModuleImport[] {
  const moduleDir = join(MODULES_DIR, moduleName);
  const files = collectTsFiles(moduleDir);
  const imports: CrossModuleImport[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const fromRegex = /from\s+["']#modules\/([^/"]+)\//gm;
    let match;
    while ((match = fromRegex.exec(content)) !== null) {
      const targetModule = match[1];
      if (targetModule === moduleName) continue;

      const before = content.slice(0, match.index);
      const lastImportIdx = before.lastIndexOf("import ");
      const isTypeOnly =
        lastImportIdx !== -1 &&
        /^import\s+type\b/.test(content.slice(lastImportIdx));

      imports.push({
        sourceModule: moduleName,
        targetModule,
        file: file.slice(MODULES_DIR.length + 1),
        typeOnly: isTypeOnly,
      });
    }
  }

  return imports;
}

function parseDeclaredDependencies(moduleName: string): string[] {
  const indexPath = join(MODULES_DIR, moduleName, "index.ts");
  const content = readFileSync(indexPath, "utf-8");
  const match = content.match(/dependencies:\s*\[([^\]]*)\]/);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("cross-module dependency declarations", () => {
  const moduleDirs = listModuleDirs();
  const moduleNames = new Set(moduleDirs);

  it("every runtime cross-module import has a declared dependency", () => {
    const violations: string[] = [];

    for (const moduleName of moduleDirs) {
      const imports = findCrossModuleImports(moduleName);
      const declared = new Set(parseDeclaredDependencies(moduleName));

      for (const imp of imports) {
        if (imp.typeOnly) continue;
        if (!moduleNames.has(imp.targetModule)) continue;
        if (!declared.has(imp.targetModule)) {
          violations.push(
            `${imp.sourceModule} → ${imp.targetModule} (${imp.file}) not in dependencies`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("declared dependencies reference loadable modules", () => {
    const invalid: string[] = [];

    for (const moduleName of moduleDirs) {
      const declared = parseDeclaredDependencies(moduleName);
      for (const dep of declared) {
        if (!moduleNames.has(dep)) {
          invalid.push(`${moduleName} declares "${dep}" which is not a loadable module`);
        }
      }
    }

    expect(invalid).toEqual([]);
  });
});
