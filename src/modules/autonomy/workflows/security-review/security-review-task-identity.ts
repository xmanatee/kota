import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import { getRepoTaskContainerDir, listVerifiedFullRepoTasks, readVerifiedRepoTaskFile } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { SecurityReviewState } from "./review-state.js";
import type { SecurityRevalidatedFinding } from "./security-review-output.js";

export function securityFindingFamilyKey(finding: Pick<SecurityRevalidatedFinding, "productionOwner" | "violatedInvariant">): string {
  return createHash("sha256").update(JSON.stringify([finding.productionOwner, finding.violatedInvariant])).digest("hex");
}

function securityFindingEvidenceKey(finding: Pick<SecurityRevalidatedFinding, "evidenceIdentity">, familyKey: string): string {
  // Locations and reviewer prose are not finding identity. The reviewer names a
  // stable exploit/evidence revision. A regression must name a new revision.
  return createHash("sha256").update(JSON.stringify([
    familyKey, finding.evidenceIdentity,
  ])).digest("hex");
}

function retainedLegacyEvidence(body: string, evidenceIdentity: string): { present: boolean; current: boolean } {
  let present = false;
  for (const record of body.split(/^security evidence: /m).slice(1)) {
    if (/^evidence identity: /m.test(record)) continue;
    present = true;
    const key = /^([a-f0-9]{64})$/m.exec(record)?.[1];
    const productionOwner = /^production owner: (.+)$/m.exec(record)?.[1];
    const violatedInvariant = /^violated invariant: (.+)$/m.exec(record)?.[1];
    const excerpts = [...record.matchAll(/^excerpt:\n+((?:>[^\n]*(?:\n|$))+)/gm)].map((match) =>
      match[1]!.trimEnd().split("\n").map((line) => line.replace(/^> ?/, "")).join("\n").replace(/\\#/g, "#").trim(),
    );
    if (!key || !productionOwner || !violatedInvariant || !excerpts.length) continue;
    // Legacy hashes omitted a readable revision. Verify the incoming revision
    // against retained inputs, never against a later review's prose. If historic
    // formatting was lossy, a mismatch requires explicit revalidated lineage.
    const digest = createHash("sha256").update(JSON.stringify([
      securityFindingFamilyKey({ productionOwner, violatedInvariant }), evidenceIdentity, excerpts.sort(),
    ])).digest("hex");
    if (digest === key) return { present: true, current: true };
  }
  return { present, current: false };
}

export function resolveSecurityFindingTaskTarget(workspaceRoot: string, finding: SecurityRevalidatedFinding) {
  const proposedKey = securityFindingFamilyKey(finding);
  const tasks = listVerifiedFullRepoTasks(workspaceRoot);
  const nominated = finding.existingTaskId ? tasks.find((task) => task.id === finding.existingTaskId) : undefined;
  if (finding.existingTaskId && !nominated) throw new Error("Security finding cites a missing existing task");
  if (nominated && /^## Superseded$/m.test(nominated.body)) throw new Error("Security finding must cite the canonical task, not a superseded record");
  const markers = nominated?.body.split("\n").filter((line) => line.startsWith("security family: ")) ?? [];
  if (markers.length > 1 || markers.some((line) => !/^security family: [a-f0-9]{64}$/.test(line))) throw new Error("Security task has ambiguous family identity");
  // An independently revalidated task nomination anchors the family. Reviewer
  // synonyms cannot rename it; unmarked historical tasks use their durable id.
  const key = nominated
    ? /^security family: ([a-f0-9]{64})$/m.exec(nominated.body)?.[1] ?? createHash("sha256").update(nominated.id).digest("hex")
    : proposedKey;
  const matches = tasks.filter((task) => new RegExp(`^security family: ${key}$`, "m").test(task.body) && !/^## Superseded$/m.test(task.body));
  if (matches.length > 1) throw new Error(`Security family ${key} has multiple canonical tasks`);
  if (nominated && tasks.some((task) => task.id !== nominated.id && !/^## Superseded$/m.test(task.body) && new RegExp(`^security family: ${proposedKey}$`, "m").test(task.body))) throw new Error("Security family has conflicting task nominations");
  if (nominated && matches[0] && nominated.id !== matches[0].id) throw new Error("Security family has conflicting task nominations");
  const existing = matches[0] ?? nominated;
  const id = existing?.id ?? `task-security-review-${key.slice(0, 24)}`;
  if (!existing && tasks.some((task) => task.id === id)) throw new Error(`Security task identity collision: ${id}`);
  const evidenceKey = securityFindingEvidenceKey(finding, key);
  const lineage = finding.evidenceLineage;
  if (lineage) {
    const references = existing?.body.split("\n").filter((line) => /^(security evidence|finding id): /.test(line)).map((line) => line.slice(line.indexOf(": ") + 2)) ?? [];
    if (!nominated || !references.includes(lineage.reference)) throw new Error("Security evidence lineage must reference evidence retained in the nominated task");
    if (lineage.kind !== "unchanged" && lineage.reference === evidenceKey) throw new Error("New security evidence requires a distinct revision");
  }
  const legacy = retainedLegacyEvidence(existing?.body ?? "", finding.evidenceIdentity);
  if (lineage && lineage.kind !== "unchanged" && legacy.current) throw new Error("New security evidence requires a distinct revision");
  const current = lineage?.kind === "unchanged" || legacy.current ||
    (existing?.body.split("\n").includes(`security evidence: ${evidenceKey}`) ?? false);
  // Appending a versioned variant does not give the older records an identity.
  // Preserve their lineage requirement when a versioned variant reopens work
  // and through subsequent completion cycles.
  const unversionedHistory = existing && (existing.state === "done" || existing.state === "dropped" || /^evidence identity: /m.test(existing.body)) &&
    existing.body.split(/^## Additional confirmed evidence$/m).some((record) => !/^evidence identity: /m.test(record));
  return {
    id, key, evidenceKey, existing, current,
    requiresEvidenceLineage: !current && Boolean(legacy.present || unversionedHistory) && lineage === null,
    path: join(getRepoTaskContainerDir(workspaceRoot, existing?.state ?? "open"), `${id}.md`),
    attrs: existing ? parseFlatFrontMatter(readVerifiedRepoTaskFile(workspaceRoot, existing.state, existing.id)!.content).attrs : {},
  };
}

/** Retain unresolved outbox entries for their owner without poisoning other families. */
export function resolvePendingSecurityFindings(workspaceRoot: string, pending: SecurityReviewState["pending"]) {
  const resolved: { entry: SecurityReviewState["pending"][number]; target: ReturnType<typeof resolveSecurityFindingTaskTarget> }[] = [];
  const lineageRequired: typeof resolved = [];
  const parked: { runId: string; findingId: string; reason: string }[] = [];
  for (const entry of pending) {
    try {
      const target = resolveSecurityFindingTaskTarget(workspaceRoot, entry.finding);
      if (target.requiresEvidenceLineage) {
        lineageRequired.push({ entry, target });
        parked.push({ runId: entry.runId, findingId: entry.finding.id, reason: "Legacy security evidence requires revalidated evidence lineage before task mutation" });
      } else resolved.push({ entry, target });
    } catch (error) {
      parked.push({ runId: entry.runId, findingId: entry.finding.id, reason: String(error) });
    }
  }
  return { resolved, lineageRequired, parked };
}
