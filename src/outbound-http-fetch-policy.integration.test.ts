import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");
const BASELINE_PATH = join(import.meta.dirname, "outbound-http-fetch-baseline.json");
const SCAN_ROOTS = [join(REPO_ROOT, "src"), join(REPO_ROOT, "clients")];
const ALLOWED_LOW_LEVEL_ADAPTERS = new Set([
  "src/core/outbound-http/dispatcher.ts",
  "clients/mobile/src/daemon/http.ts",
  "clients/web/src/api/client-runtime.ts",
]);
const GLOBAL_OBJECT_NAMES = new Set(["global", "globalThis", "self", "window"]);
const PROGRAM_OPTIONS = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  noResolve: true,
  skipLibCheck: true,
} satisfies ts.CompilerOptions;

function* walk(directory: string): IterableIterator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "fixtures" && entry.name !== "node_modules") yield* walk(path);
      continue;
    }
    if (!entry.isFile() || ![".ts", ".tsx"].includes(extname(entry.name))) continue;
    const repoPath = relative(REPO_ROOT, path).replace(/\\/g, "/");
    if (isTestSupport(repoPath)) continue;
    yield path;
  }
}

function isTestSupport(path: string): boolean {
  return /(?:\.test|\.integration|\.test-cases|test-helpers|test-support)\.tsx?$/.test(path);
}

function isTypePosition(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current)) return true;
    if (ts.isSourceFile(current)) return false;
  }
  return false;
}

function isGlobalSymbol(identifier: ts.Identifier, checker: ts.TypeChecker): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (!symbol) return false;
  const declarations = symbol.declarations ?? [];
  if (identifier.text === "globalThis" && declarations.length === 0) return true;
  return declarations.length > 0 &&
    declarations.every((declaration) => declaration.getSourceFile().isDeclarationFile);
}

function isGlobalObject(node: ts.Expression, checker: ts.TypeChecker): node is ts.Identifier {
  return ts.isIdentifier(node) && GLOBAL_OBJECT_NAMES.has(node.text) && isGlobalSymbol(node, checker);
}

function isGlobalFetchProperty(node: ts.Node, checker: ts.TypeChecker): boolean {
  if (isTypePosition(node)) return false;
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === "fetch" && isGlobalObject(node.expression, checker);
  }
  return ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === "fetch" &&
    isGlobalObject(node.expression, checker);
}

function isDirectGlobalFetchBinding(node: ts.BindingElement, checker: ts.TypeChecker): boolean {
  const propertyName = node.propertyName ?? node.name;
  if (!ts.isIdentifier(propertyName) || propertyName.text !== "fetch") return false;
  const pattern = node.parent;
  if (!ts.isObjectBindingPattern(pattern)) return false;
  const declaration = pattern.parent;
  if (
    !ts.isVariableDeclaration(declaration) &&
    !ts.isParameter(declaration) &&
    !ts.isBindingElement(declaration)
  ) {
    return false;
  }
  return declaration.name === pattern &&
    declaration.initializer !== undefined &&
    isGlobalObject(declaration.initializer, checker);
}

function isBareFetchReference(node: ts.Identifier, checker: ts.TypeChecker): boolean {
  if (node.text !== "fetch" || isTypePosition(node)) return false;
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) return false;
  if (ts.isBindingElement(node.parent) && node.parent.propertyName === node) return false;
  return isGlobalSymbol(node, checker);
}

function normalizedNodeFingerprint(node: ts.Node, source: ts.SourceFile): string {
  const scanner = ts.createScanner(ts.ScriptTarget.ESNext, true, ts.LanguageVariant.Standard, node.getText(source));
  const hash = createHash("sha256");
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    hash.update(`${token}:${scanner.getTokenText()}\n`);
  }
  return hash.digest("hex").slice(0, 16);
}

function callSiteBoundary(node: ts.Node): ts.Node {
  for (let current: ts.Node | undefined = node; current && !ts.isSourceFile(current); current = current.parent) {
    if (ts.isStatement(current) || ts.isClassElement(current)) return current;
  }
  return node;
}

function rawFetchCallSite(node: ts.Node, source: ts.SourceFile): string {
  const boundary = callSiteBoundary(node);
  return `${ts.SyntaxKind[node.kind]}:${ts.SyntaxKind[boundary.kind]}:${normalizedNodeFingerprint(boundary, source)}`;
}

function rawGlobalFetchCallSites(source: ts.SourceFile, checker: ts.TypeChecker): string[] {
  const callSites: string[] = [];
  function visit(node: ts.Node): void {
    if (isGlobalFetchProperty(node, checker)) {
      callSites.push(rawFetchCallSite(node, source));
      return;
    }
    if (ts.isBindingElement(node) && isDirectGlobalFetchBinding(node, checker)) {
      callSites.push(rawFetchCallSite(node, source));
      return;
    }
    if (ts.isIdentifier(node) && isBareFetchReference(node, checker)) {
      callSites.push(rawFetchCallSite(node, source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return callSites.sort();
}

function fixtureRawGlobalFetchCallSites(sourceText: string): string[] {
  const fileName = "/outbound-http-fetch-policy-fixture.ts";
  const host = ts.createCompilerHost(PROGRAM_OPTIONS);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (path) => path === fileName || ts.sys.fileExists(path);
  host.readFile = (path) => path === fileName ? sourceText : ts.sys.readFile(path);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === fileName
      ? ts.createSourceFile(path, sourceText, languageVersion, true)
      : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([fileName], PROGRAM_OPTIONS, host);
  const source = program.getSourceFile(fileName);
  if (!source) throw new Error(`Failed to load raw-fetch fixture ${fileName}`);
  return rawGlobalFetchCallSites(source, program.getTypeChecker());
}

function scanCurrent(): Record<string, string[]> {
  const paths = SCAN_ROOTS.flatMap((root) => [...walk(root)]);
  const program = ts.createProgram(paths, PROGRAM_OPTIONS);
  const checker = program.getTypeChecker();
  const callSites: Record<string, string[]> = {};
  for (const path of paths) {
    const repoPath = relative(REPO_ROOT, path).replace(/\\/g, "/");
    if (ALLOWED_LOW_LEVEL_ADAPTERS.has(repoPath)) continue;
    const source = program.getSourceFile(path);
    if (!source) throw new Error(`Failed to load raw-fetch policy source ${repoPath}`);
    const fileCallSites = rawGlobalFetchCallSites(source, checker);
    if (fileCallSites.length > 0) callSites[repoPath] = fileCallSites;
  }
  return Object.fromEntries(Object.entries(callSites).sort(([left], [right]) => left.localeCompare(right)));
}

function newRawFetchCallSites(
  current: Readonly<Record<string, readonly string[]>>,
  baseline: Readonly<Record<string, readonly string[]>>,
): string[] {
  const offenders: string[] = [];
  for (const [file, callSites] of Object.entries(current)) {
    const remainingBaseline = [...(baseline[file] ?? [])];
    for (const callSite of callSites) {
      const baselineIndex = remainingBaseline.indexOf(callSite);
      if (baselineIndex === -1) offenders.push(`${file}: new raw fetch call site ${callSite}`);
      else remainingBaseline.splice(baselineIndex, 1);
    }
  }
  return offenders;
}

describe("outbound HTTP raw-fetch policy", () => {
  it("detects global fetch references without flagging types, adapter methods, or injected functions", () => {
    expect(
      fixtureRawGlobalFetchCallSites(`
        fetch(url);
        const direct = fetch;
        const selected = options.fetchImpl ?? fetch;
        const bound = globalThis.fetch.bind(globalThis);
        const indexed = globalThis["fetch"];
        const { fetch: destructured } = globalThis;
      `),
    ).toHaveLength(6);
    expect(
      fixtureRawGlobalFetchCallSites(`
        type FetchImplementation = typeof fetch;
        declare const client: { fetch(url: string): Promise<Response> };
        client.fetch(url);
        function useInjected(fetch: FetchImplementation) {
          return fetch(url);
        }
      `),
    ).toHaveLength(0);
  });

  it("rejects a same-count raw fetch replacement in a baseline file", () => {
    const baseline = {
      "src/example.ts": fixtureRawGlobalFetchCallSites("fetch(oldUrl);"),
    };
    const current = {
      "src/example.ts": fixtureRawGlobalFetchCallSites("fetch(newUrl);"),
    };

    expect(baseline["src/example.ts"]).toHaveLength(1);
    expect(current["src/example.ts"]).toHaveLength(1);
    expect(newRawFetchCallSites(current, baseline)).toEqual([
      expect.stringContaining("src/example.ts: new raw fetch call site"),
    ]);
  });

  it("rejects new raw fetch paths outside named low-level adapters", () => {
    const current = scanCurrent();
    if (process.env.OUTBOUND_HTTP_FETCH_REGENERATE === "1") {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
      return;
    }
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<string, string[]>;
    const offenders = newRawFetchCallSites(current, baseline);
    if (offenders.length > 0) {
      throw new Error(
        [
          "Raw global fetch is restricted to the shared outbound HTTP dispatcher and client-platform roots.",
          "Use an explicit OUTBOUND_HTTP_PROFILES selection through outboundHttp. Offenders:",
          ...offenders.map((offender) => `  - ${offender}`),
        ].join("\n"),
      );
    }
    expect(offenders).toEqual([]);
  });
});
