import { readFileSync } from "node:fs";
import { join, posix, relative } from "node:path";
import ts from "typescript";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type { AutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { collectAstArchitectureObservations, collectTypeScriptFiles, extractAstImports } from "./ast-provider.js";
import { computeFingerprint } from "./fingerprint.js";
import type { ArchitectureObservation } from "./types.js";

export function normalizeObservationTarget(target: string): string {
  const trimmed = target.trim();
  const path = posix.normalize(trimmed.startsWith("module:")
    ? `src/modules/${trimmed.slice("module:".length)}` : trimmed).replace(/\/+$/, "");
  return path === "." || path === "" ? "repo" : path;
}

export function observationsForTarget(observations: readonly ArchitectureObservation[], targetScope: string): ArchitectureObservation[] {
  const target = normalizeObservationTarget(targetScope);
  return observations.filter((observation) => target === "repo" || observation.category === "delivery" ||
    observation.affectedPaths.some((path) => path === target || path.startsWith(`${target}/`) || target.startsWith(`${path}/`)));
}

// Exact function-body clones are triage evidence only. Dynamic callers,
// different contracts, and domain-specific semantics still need investigation.
export function collectObservations(input: { workspaceRoot: string }): ArchitectureObservation[] {
  const observations = collectAstArchitectureObservations(input.workspaceRoot);
  const clones = new Map<string, Array<{ file: string; line: number; imports: string[] }>>();
  const printer = ts.createPrinter({ removeComments: true });
  for (const file of collectTypeScriptFiles(join(input.workspaceRoot, "src"))) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const imports = extractAstImports(source).map((entry) => entry.specifier);
    function visit(node: ts.Node) {
      if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
          node.body && ts.isBlock(node.body) && node.body.statements.length >= 3) {
        const fingerprint = computeFingerprint(printer.printNode(ts.EmitHint.Unspecified, node.body, source));
        const sites = clones.get(fingerprint) ?? [];
        sites.push({ file: relative(input.workspaceRoot, file), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, imports });
        clones.set(fingerprint, sites);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const [bodyFingerprint, sites] of clones) {
    if (new Set(sites.map((site) => site.file)).size < 2) continue;
    const evidence = { bodyFingerprint, sites: sites.sort((a, b) => a.file.localeCompare(b.file)) };
    const fingerprint = computeFingerprint({ bodyFingerprint, sites: evidence.sites.map(({ file, imports }) => ({ file, imports: [...new Set(imports)].sort() })) });
    observations.push({
      id: `clone-${fingerprint}`, kind: "duplicated-implementation-chunk", category: "complexity",
      affectedPaths: [...new Set(evidence.sites.map((site) => site.file))],
      targetScope: "repo", summary: "Exact function bodies in multiple files; common semantics and callers are unverified.",
      fingerprint, evidence, timestamp: new Date().toISOString(),
    });
  }
  return observations;
}

export const collectObservationsOperation = defineWorkflowBlockingOperation<
  { workspaceRoot: string }, ArchitectureObservation[]
>(import.meta.url, "collectObservations");

export function deliveryObservations(projection: AutonomyIssueProjection): ArchitectureObservation[] {
  return projection.issues.filter((issue) => issue.status !== "resolved" && issue.actionability === "local-code")
    .map((issue) => ({
      id: issue.issueKey, kind: "delivery-friction", category: "delivery", targetScope: "repo",
      affectedPaths: [],
      summary: issue.summaries.join("; "),
      fingerprint: computeFingerprint({ issueKey: issue.issueKey, semanticFingerprint: issue.semanticFingerprint }),
      evidence: { issueKey: issue.issueKey, source: issue.source, evidenceRefs: issue.evidenceRefs, taskIds: issue.links.taskIds },
      timestamp: issue.lastSeenAt,
    }));
}
