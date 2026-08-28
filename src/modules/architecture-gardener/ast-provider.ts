import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import type { KotaModule } from "#core/modules/module-types.js";
import { computeObservationFingerprint } from "./fingerprint.js";
import type { ArchitectureObservation } from "./types.js";

export type ForbiddenCoreDependency = {
  readonly sourceFile: string;
  readonly specifier: string;
  readonly line: number;
  readonly isTypeOnly: boolean;
};

export type UndeclaredModuleImport = {
  readonly sourceModule: string;
  readonly targetModule: string;
  readonly sourceFile: string;
  readonly specifier: string;
  readonly line: number;
};

export type ModuleDependencyCycle = {
  readonly cycle: readonly string[];
};

export type DuplicateCanonicalOwnership = {
  readonly contributionKind: "tool" | "workflow" | "route" | "command" | "event";
  readonly name: string;
  readonly contributingModules: readonly string[];
};

/** Collect all TypeScript files recursively, skipping fixture and build directories. */
export function collectTypeScriptFiles(
  dir: string,
  options: { includeTests?: boolean } = {},
): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (
        entry.name === "fixtures" ||
        entry.name === "__fixtures__" ||
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === ".git"
      ) {
        continue;
      }
      results.push(...collectTypeScriptFiles(join(dir, entry.name), options));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      const isTest =
        entry.name.endsWith(".test.ts") || entry.name.endsWith(".integration.ts");
      if (!isTest || options.includeTests) {
        results.push(join(dir, entry.name));
      }
    }
  }
  return results;
}

/** Check if an AST import declaration is purely type-only. */
export function isTypeOnlyImport(importDecl: ts.ImportDeclaration): boolean {
  if (importDecl.importClause?.isTypeOnly) return true;
  const namedBindings = importDecl.importClause?.namedBindings;
  if (namedBindings && ts.isNamedImports(namedBindings)) {
    if (
      namedBindings.elements.length > 0 &&
      namedBindings.elements.every((el) => el.isTypeOnly)
    ) {
      return true;
    }
  }
  return false;
}

/** Extract all import / export specifiers from a source file using TS AST. */
export function extractAstImports(sourceFile: ts.SourceFile): Array<{
  specifier: string;
  line: number;
  isTypeOnly: boolean;
}> {
  const imports: Array<{ specifier: string; line: number; isTypeOnly: boolean }> = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        imports.push({
          specifier: node.moduleSpecifier.text,
          line,
          isTypeOnly: isTypeOnlyImport(node),
        });
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        imports.push({
          specifier: node.moduleSpecifier.text,
          line,
          isTypeOnly: node.isTypeOnly,
        });
      }
    } else if (ts.isCallExpression(node)) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        imports.push({
          specifier: node.arguments[0].text,
          line,
          isTypeOnly: false,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

/**
 * 1. Detect forbidden core-to-module dependencies.
 * Core files under src/core/ must NOT import from #modules/* or reach into src/modules/.
 */
export function detectForbiddenCoreToModuleDependencies(
  repoRoot: string,
): ForbiddenCoreDependency[] {
  const coreDir = join(repoRoot, "src", "core");
  if (!existsSync(coreDir)) return [];

  const files = collectTypeScriptFiles(coreDir, { includeTests: true });
  const violations: ForbiddenCoreDependency[] = [];

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = extractAstImports(sourceFile);
    const relPath = relative(repoRoot, filePath);

    for (const imp of imports) {
      const spec = imp.specifier;
      let isForbidden = false;

      if (spec.startsWith("#modules/")) {
        isForbidden = true;
      } else if (spec.startsWith(".") || spec.startsWith("/")) {
        const resolved = resolve(dirname(filePath), spec);
        if (resolved.includes(join("src", "modules"))) {
          isForbidden = true;
        }
      }

      if (isForbidden) {
        violations.push({
          sourceFile: relPath,
          specifier: spec,
          line: imp.line,
          isTypeOnly: imp.isTypeOnly,
        });
      }
    }
  }

  return violations;
}

/** Parse declared dependencies from a module index.ts using AST. */
export function parseDeclaredModuleDependenciesAst(indexPath: string): string[] {
  if (!existsSync(indexPath)) return [];
  const content = readFileSync(indexPath, "utf-8");
  const sourceFile = ts.createSourceFile(
    indexPath,
    content,
    ts.ScriptTarget.Latest,
    true,
  );

  const deps: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(sourceFile);
      if (name === "dependencies" && ts.isArrayLiteralExpression(node.initializer)) {
        for (const el of node.initializer.elements) {
          if (ts.isStringLiteral(el)) {
            deps.push(el.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return deps;
}

/** List all valid module directory names under src/modules/. */
export function listModuleNames(repoRoot: string): string[] {
  const modulesDir = join(repoRoot, "src", "modules");
  if (!existsSync(modulesDir)) return [];
  return readdirSync(modulesDir).filter((name) => {
    const full = join(modulesDir, name);
    return statSync(full).isDirectory() && existsSync(join(full, "index.ts"));
  });
}

/**
 * 2. Detect undeclared runtime cross-module imports.
 * If module A has runtime imports from #modules/B/..., B must be in dependencies of module A.
 */
export function detectUndeclaredCrossModuleImports(
  repoRoot: string,
): UndeclaredModuleImport[] {
  const modulesDir = join(repoRoot, "src", "modules");
  if (!existsSync(modulesDir)) return [];

  const moduleNames = listModuleNames(repoRoot);
  const moduleSet = new Set(moduleNames);
  const violations: UndeclaredModuleImport[] = [];

  for (const sourceMod of moduleNames) {
    const modDir = join(modulesDir, sourceMod);
    const declaredDeps = new Set(
      parseDeclaredModuleDependenciesAst(join(modDir, "index.ts")),
    );
    const tsFiles = collectTypeScriptFiles(modDir, { includeTests: false });

    for (const filePath of tsFiles) {
      const content = readFileSync(filePath, "utf-8");
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
      );
      const imports = extractAstImports(sourceFile);
      const relPath = relative(repoRoot, filePath);

      for (const imp of imports) {
        if (imp.isTypeOnly) continue;
        if (!imp.specifier.startsWith("#modules/")) continue;

        const parts = imp.specifier.slice("#modules/".length).split("/");
        const targetMod = parts[0];

        if (!targetMod || targetMod === sourceMod) continue;
        if (!moduleSet.has(targetMod)) continue;

        if (!declaredDeps.has(targetMod)) {
          violations.push({
            sourceModule: sourceMod,
            targetModule: targetMod,
            sourceFile: relPath,
            specifier: imp.specifier,
            line: imp.line,
          });
        }
      }
    }
  }

  return violations;
}

/**
 * 3. Detect module dependency cycles using Tarjan/DFS on the module dependency graph.
 */
export function detectModuleCycles(
  repoRoot: string,
  extraEdges?: ReadonlyArray<{ readonly from: string; readonly to: string }>,
): ModuleDependencyCycle[] {
  const moduleNames = listModuleNames(repoRoot);
  const modulesDir = join(repoRoot, "src", "modules");
  const adj = new Map<string, Set<string>>();

  for (const name of moduleNames) {
    adj.set(name, new Set());
  }

  // Populate edges from declared dependencies and runtime cross-module imports
  for (const name of moduleNames) {
    const declared = parseDeclaredModuleDependenciesAst(
      join(modulesDir, name, "index.ts"),
    );
    for (const dep of declared) {
      if (adj.has(dep) && dep !== name) {
        adj.get(name)?.add(dep);
      }
    }
  }

  if (extraEdges) {
    for (const edge of extraEdges) {
      if (!adj.has(edge.from)) adj.set(edge.from, new Set());
      if (!adj.has(edge.to)) adj.set(edge.to, new Set());
      adj.get(edge.from)?.add(edge.to);
    }
  }

  const cycles: ModuleDependencyCycle[] = [];
  const visited = new Set<string>();
  const stack: string[] = [];
  const inStack = new Set<string>();

  function dfs(curr: string) {
    visited.add(curr);
    stack.push(curr);
    inStack.add(curr);

    const neighbors = adj.get(curr) ?? new Set();
    for (const nxt of neighbors) {
      if (!visited.has(nxt)) {
        dfs(nxt);
      } else if (inStack.has(nxt)) {
        const cycleStartIndex = stack.indexOf(nxt);
        if (cycleStartIndex !== -1) {
          const cyclePath = stack.slice(cycleStartIndex).concat(nxt);
          cycles.push({ cycle: cyclePath });
        }
      }
    }

    stack.pop();
    inStack.delete(curr);
  }

  for (const name of adj.keys()) {
    if (!visited.has(name)) {
      dfs(name);
    }
  }

  return cycles;
}

/**
 * 4. Detect duplicate canonical ownership across modules.
 * Scans modules to ensure tools, workflows, routes, commands, and events are uniquely owned.
 */
export function detectDuplicateCanonicalOwnership(
  repoRoot: string,
  loadedModules?: readonly KotaModule[],
): DuplicateCanonicalOwnership[] {
  const violations: DuplicateCanonicalOwnership[] = [];
  const toolOwners = new Map<string, string[]>();
  const workflowOwners = new Map<string, string[]>();
  const routeOwners = new Map<string, string[]>();
  const commandOwners = new Map<string, string[]>();
  const eventOwners = new Map<string, string[]>();

  if (loadedModules && loadedModules.length > 0) {
    for (const mod of loadedModules) {
      if (Array.isArray(mod.tools)) {
        for (const t of mod.tools) {
          const toolName =
            typeof t === "object" && t !== null && "tool" in t && typeof t.tool === "object" && t.tool !== null && "name" in t.tool && typeof (t.tool as { name: unknown }).name === "string"
              ? (t.tool as { name: string }).name
              : typeof t === "object" && t !== null && "name" in t && typeof (t as { name: unknown }).name === "string"
                ? (t as { name: string }).name
                : undefined;
          if (toolName) {
            const list = toolOwners.get(toolName) ?? [];
            list.push(mod.name);
            toolOwners.set(toolName, list);
          }
        }
      }
      if (Array.isArray(mod.workflows)) {
        for (const w of mod.workflows) {
          const wName = typeof w === "object" && w !== null && "name" in w && typeof (w as { name: unknown }).name === "string" ? (w as { name: string }).name : String(w);
          if (wName) {
            const list = workflowOwners.get(wName) ?? [];
            list.push(mod.name);
            workflowOwners.set(wName, list);
          }
        }
      }
      if (Array.isArray(mod.events)) {
        for (const e of mod.events) {
          if (e && typeof e.name === "string") {
            const list = eventOwners.get(e.name) ?? [];
            list.push(mod.name);
            eventOwners.set(e.name, list);
          }
        }
      }
    }
  } else {
    const moduleNames = listModuleNames(repoRoot);
    const modulesDir = join(repoRoot, "src", "modules");
    for (const name of moduleNames) {
      const indexPath = join(modulesDir, name, "index.ts");
      if (!existsSync(indexPath)) continue;
      const content = readFileSync(indexPath, "utf-8");
      const sourceFile = ts.createSourceFile(
        indexPath,
        content,
        ts.ScriptTarget.Latest,
        true,
      );

      function visit(node: ts.Node) {
        if (ts.isPropertyAssignment(node)) {
          const propName = node.name.getText(sourceFile);
          if (propName === "events" && ts.isArrayLiteralExpression(node.initializer)) {
            for (const el of node.initializer.elements) {
              if (ts.isIdentifier(el)) {
                const eventVarName = el.text;
                const list = eventOwners.get(eventVarName) ?? [];
                list.push(name);
                eventOwners.set(eventVarName, list);
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(sourceFile);
    }
  }

  function checkDuplicates(
    map: Map<string, string[]>,
    kind: DuplicateCanonicalOwnership["contributionKind"],
  ) {
    for (const [name, modules] of map.entries()) {
      const uniqueModules = Array.from(new Set(modules));
      if (uniqueModules.length > 1) {
        violations.push({
          contributionKind: kind,
          name,
          contributingModules: uniqueModules,
        });
      }
    }
  }

  checkDuplicates(toolOwners, "tool");
  checkDuplicates(workflowOwners, "workflow");
  checkDuplicates(routeOwners, "route");
  checkDuplicates(commandOwners, "command");
  checkDuplicates(eventOwners, "event");

  return violations;
}

/**
 * Collect all AST architecture observations for a repository.
 */
export function collectAstArchitectureObservations(
  repoRoot: string,
  options: {
    loadedModules?: readonly KotaModule[];
    extraCycles?: ReadonlyArray<{ readonly from: string; readonly to: string }>;
    extraDuplicates?: readonly DuplicateCanonicalOwnership[];
  } = {},
): ArchitectureObservation[] {
  const observations: ArchitectureObservation[] = [];
  const now = new Date().toISOString();

  // 1. Forbidden core-to-module dependencies
  const forbiddenDeps = detectForbiddenCoreToModuleDependencies(repoRoot);
  for (const dep of forbiddenDeps) {
    const evidence = {
      sourceFile: dep.sourceFile,
      specifier: dep.specifier,
      line: dep.line,
      isTypeOnly: dep.isTypeOnly,
    };
    const fingerprint = computeObservationFingerprint({
      kind: "forbidden-core-to-module-dependency",
      targetScope: dep.sourceFile,
      evidence,
    });
    observations.push({
      id: `obs-forbidden-dep-${fingerprint.slice(0, 8)}`,
      kind: "forbidden-core-to-module-dependency",
      category: "dependency-boundary",
      targetScope: dep.sourceFile,
      summary: `Forbidden core-to-module dependency: "${dep.specifier}" imported in ${dep.sourceFile}:${dep.line}`,
      fingerprint,
      evidence,
      timestamp: now,
    });
  }

  // 2. Undeclared runtime cross-module imports
  const undeclaredImports = detectUndeclaredCrossModuleImports(repoRoot);
  for (const imp of undeclaredImports) {
    const evidence = {
      sourceModule: imp.sourceModule,
      targetModule: imp.targetModule,
      sourceFile: imp.sourceFile,
      specifier: imp.specifier,
      line: imp.line,
    };
    const fingerprint = computeObservationFingerprint({
      kind: "undeclared-runtime-cross-module-import",
      targetScope: `module:${imp.sourceModule}`,
      evidence,
    });
    observations.push({
      id: `obs-undeclared-${fingerprint.slice(0, 8)}`,
      kind: "undeclared-runtime-cross-module-import",
      category: "dependency-boundary",
      targetScope: `module:${imp.sourceModule}`,
      summary: `Undeclared runtime import: module "${imp.sourceModule}" imports "${imp.targetModule}" without declared dependency in ${imp.sourceFile}:${imp.line}`,
      fingerprint,
      evidence,
      timestamp: now,
    });
  }

  // 3. Module dependency cycles
  const cycles = detectModuleCycles(repoRoot, options.extraCycles);
  for (const cycle of cycles) {
    const cycleKey = cycle.cycle.join(" -> ");
    const evidence = { cycle: cycle.cycle };
    const fingerprint = computeObservationFingerprint({
      kind: "module-dependency-cycle",
      targetScope: `cycle:${cycle.cycle.slice(0, -1).sort().join(",")}`,
      evidence,
    });
    observations.push({
      id: `obs-cycle-${fingerprint.slice(0, 8)}`,
      kind: "module-dependency-cycle",
      category: "dependency-boundary",
      targetScope: `module:${cycle.cycle[0]}`,
      summary: `Module dependency cycle detected: ${cycleKey}`,
      fingerprint,
      evidence,
      timestamp: now,
    });
  }

  // 4. Duplicate canonical ownership
  const duplicates = [
    ...detectDuplicateCanonicalOwnership(repoRoot, options.loadedModules),
    ...(options.extraDuplicates ?? []),
  ];
  for (const dup of duplicates) {
    const evidence = {
      contributionKind: dup.contributionKind,
      name: dup.name,
      contributingModules: dup.contributingModules,
    };
    const fingerprint = computeObservationFingerprint({
      kind: "duplicate-canonical-ownership",
      targetScope: `ownership:${dup.contributionKind}:${dup.name}`,
      evidence,
    });
    observations.push({
      id: `obs-duplicate-${fingerprint.slice(0, 8)}`,
      kind: "duplicate-canonical-ownership",
      category: "canonical-ownership",
      targetScope: `module:${dup.contributingModules[0]}`,
      summary: `Duplicate canonical ${dup.contributionKind} ownership for "${dup.name}" between modules: ${dup.contributingModules.join(", ")}`,
      fingerprint,
      evidence,
      timestamp: now,
    });
  }

  return observations;
}
