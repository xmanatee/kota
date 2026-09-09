import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import { getRepoTaskContainerDir, listVerifiedFullRepoTasks, readVerifiedRepoTaskFile } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { SecurityRevalidatedFinding } from "./security-review-output.js";

export function securityFindingFamilyKey(finding: Pick<SecurityRevalidatedFinding, "productionOwner" | "violatedInvariant">): string {
  return createHash("sha256").update(JSON.stringify([finding.productionOwner, finding.violatedInvariant])).digest("hex");
}

export function securityFindingEvidenceKey(finding: SecurityRevalidatedFinding): string {
  // Locations and reviewer prose are not finding identity. The reviewer names a
  // stable exploit/evidence revision; cited code changing supplies new evidence too.
  return createHash("sha256").update(JSON.stringify([
    securityFindingFamilyKey(finding), finding.evidenceIdentity,
    finding.evidence.map(({ excerpt }) => excerpt.trim()).sort(),
  ])).digest("hex");
}

export function resolveSecurityFindingTaskTarget(workspaceRoot: string, finding: SecurityRevalidatedFinding) {
  const key = securityFindingFamilyKey(finding);
  const tasks = listVerifiedFullRepoTasks(workspaceRoot);
  const matches = tasks.filter((task) => new RegExp(`^security family: ${key}$`, "m").test(task.body) && !/^## Superseded$/m.test(task.body));
  if (matches.length > 1) throw new Error(`Security family ${key} has multiple canonical tasks`);
  const nominated = finding.existingTaskId ? tasks.find((task) => task.id === finding.existingTaskId) : undefined;
  if (finding.existingTaskId && !nominated) throw new Error("Security finding cites a missing existing task");
  if (nominated && /^## Superseded$/m.test(nominated.body)) throw new Error("Security finding must cite the canonical task, not a superseded record");
  if (nominated && /^security family: /m.test(nominated.body) && !matches.includes(nominated)) throw new Error("Security finding cannot overwrite another family identity");
  if (nominated && matches[0] && nominated.id !== matches[0].id) throw new Error("Security family has conflicting task nominations");
  const existing = matches[0] ?? nominated;
  const id = existing?.id ?? `task-security-review-${key.slice(0, 24)}`;
  if (!existing && tasks.some((task) => task.id === id)) throw new Error(`Security task identity collision: ${id}`);
  return {
    id, key, existing,
    path: join(getRepoTaskContainerDir(workspaceRoot, existing?.state ?? "open"), `${id}.md`),
    attrs: existing ? parseFlatFrontMatter(readVerifiedRepoTaskFile(workspaceRoot, existing.state, existing.id)!.content).attrs : {},
    current: existing ? new RegExp(`^security evidence: ${securityFindingEvidenceKey(finding)}$`, "m").test(existing.body) : false,
  };
}
