import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  parseFlatFrontMatter,
  serializeFlatFrontMatter,
} from "#core/util/frontmatter.js";
import {
  getRepoTaskStateDir,
  listFullRepoTasks,
  moveTaskById,
  type RepoTaskFullRecord,
  type RepoTaskState,
  readVerifiedRepoTaskFile,
  writeRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { slugifyTaskTitle } from "#modules/repo-tasks/repo-tasks-operations.js";
import type {
  GeneratedWorkMarker,
  GeneratedWorkProposalAction,
  GeneratedWorkProvenance,
  GeneratedWorkTaskProposal,
} from "./generated-work-proposal-types.js";

const PROPOSAL_MARKER_RE =
  /<!-- generated-work-proposal: (\{[^\r\n]*\}) -->/;

export type GeneratedWorkTaskRecord = {
  task: RepoTaskFullRecord;
  marker: GeneratedWorkMarker;
};

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function parseMarker(body: string): GeneratedWorkMarker | null {
  const encoded = body.match(PROPOSAL_MARKER_RE)?.[1];
  if (!encoded) return null;
  const marker = JSON.parse(encoded) as GeneratedWorkMarker;
  if (typeof marker.key !== "string" || !Array.isArray(marker.provenance)) {
    throw new Error("generated-work proposal marker is malformed");
  }
  return marker;
}

function provenanceIdentity(value: GeneratedWorkProvenance): string {
  return [
    value.source,
    value.issueKey ?? "",
    value.semanticRevision?.toString() ?? "",
    ...value.evidenceRefs,
  ].join("\0");
}

function normalizeProvenance(
  value: GeneratedWorkProvenance,
): GeneratedWorkProvenance {
  return {
    ...value,
    source: value.source.trim(),
    runId: value.runId.trim(),
    evidenceRefs: [...new Set(value.evidenceRefs.map((ref) => ref.trim()).filter(Boolean))]
      .sort(),
  };
}

function mergeProvenance(
  existing: readonly GeneratedWorkProvenance[],
  incoming: GeneratedWorkProvenance,
): GeneratedWorkProvenance[] {
  const merged = new Map<string, GeneratedWorkProvenance>();
  for (const item of [...existing, incoming]) {
    const normalized = normalizeProvenance(item);
    merged.set(provenanceIdentity(normalized), normalized);
  }
  return [...merged.values()];
}

function renderTaskBody(body: string, marker: GeneratedWorkMarker): string {
  const provenance = marker.provenance.flatMap((item) => [
    `- Source: ${item.source}; run: ${item.runId}`,
    ...(item.issueKey
      ? [`  - Issue: ${item.issueKey}; revision: ${item.semanticRevision ?? "unknown"}`]
      : []),
    ...item.evidenceRefs.map((ref) => `  - Evidence: ${ref.replace(/\s+/g, " ").trim()}`),
  ]);
  return [
    body.trim(),
    "",
    "## Generated Work Provenance",
    "",
    `Proposal key: \`${marker.key}\``,
    "",
    ...provenance,
    "",
    `<!-- generated-work-proposal: ${JSON.stringify(marker)} -->`,
    "",
  ].join("\n");
}

export function findGeneratedWorkTask(
  projectDir: string,
  proposalKey: string,
): GeneratedWorkTaskRecord | null {
  const matches = listFullRepoTasks(projectDir).flatMap((task) => {
    const marker = parseMarker(task.body);
    return marker?.key === proposalKey ? [{ task, marker }] : [];
  });
  if (matches.length > 1) {
    throw new Error(`generated-work proposal ${proposalKey} has multiple task records`);
  }
  return matches[0] ?? null;
}

function chooseTaskId(projectDir: string, title: string, proposalKey: string): string {
  const slug = slugifyTaskTitle(title);
  if (!slug) throw new Error("generated-work task title produced an empty slug");
  const preferred = `task-${slug}`;
  if (!listFullRepoTasks(projectDir).some((task) => task.id === preferred)) {
    return preferred;
  }
  return `${preferred}-${stableHash(proposalKey)}`;
}

function taskAttrs(args: {
  id: string;
  state: RepoTaskState;
  proposal: GeneratedWorkTaskProposal;
  existingContent?: string;
}): Record<string, string | string[]> {
  const now = new Date().toISOString();
  const attrs = args.existingContent
    ? parseFlatFrontMatter(args.existingContent).attrs
    : {};
  attrs.id = args.id;
  attrs.title = args.proposal.title;
  attrs.status = args.state;
  attrs.priority = args.proposal.priority;
  attrs.area = args.proposal.area;
  attrs.summary = args.proposal.summary;
  attrs.created_at = typeof attrs.created_at === "string" ? attrs.created_at : now;
  attrs.updated_at = typeof attrs.updated_at === "string" ? attrs.updated_at : now;
  if (args.proposal.taskClass === "Unclassified") delete attrs.task_class;
  else attrs.task_class = args.proposal.taskClass;
  return attrs;
}

export function writeGeneratedWorkTask(args: {
  projectDir: string;
  proposal: GeneratedWorkTaskProposal;
  existing: GeneratedWorkTaskRecord | null;
}): GeneratedWorkProposalAction[] {
  const actions: GeneratedWorkProposalAction[] = [];
  const incomingProvenanceIdentity = provenanceIdentity(
    normalizeProvenance(args.proposal.provenance),
  );
  if (
    args.existing &&
    (args.existing.task.state === "ready" || args.existing.task.state === "doing") &&
    args.existing.marker.provenance.some(
      (item) =>
        provenanceIdentity(normalizeProvenance(item)) === incomingProvenanceIdentity,
    )
  ) {
    return [{ kind: "noop", reason: "task is current for this evidence revision" }];
  }
  let state: RepoTaskState;
  let taskId: string;
  let priorMarker: GeneratedWorkMarker | null = null;
  if (args.existing) {
    taskId = args.existing.task.id;
    state = args.existing.task.state;
    priorMarker = args.existing.marker;
    if (state !== "ready" && state !== "doing") {
      const fromState = state;
      moveTaskById(args.projectDir, taskId, "ready");
      state = "ready";
      actions.push({
        kind: "reopened-task",
        taskId,
        path: join("data", "tasks", state, `${taskId}.md`),
        fromState,
      });
    }
  } else {
    taskId = chooseTaskId(args.projectDir, args.proposal.title, args.proposal.proposalKey);
    state = "ready";
  }

  const existingFile = readVerifiedRepoTaskFile(args.projectDir, state, taskId);
  const marker = {
    key: args.proposal.proposalKey,
    provenance: mergeProvenance(priorMarker?.provenance ?? [], args.proposal.provenance),
  };
  const attrs = taskAttrs({
    id: taskId,
    state,
    proposal: args.proposal,
    ...(existingFile ? { existingContent: existingFile.content } : {}),
  });
  const content = serializeFlatFrontMatter(attrs, renderTaskBody(args.proposal.body, marker));
  const path = join(getRepoTaskStateDir(args.projectDir, state), `${taskId}.md`);
  if (existingFile?.content !== content) {
    attrs.updated_at = new Date().toISOString();
    writeRepoTaskFile(
      args.projectDir,
      path,
      serializeFlatFrontMatter(attrs, renderTaskBody(args.proposal.body, marker)),
    );
    actions.push({
      kind: args.existing ? "updated-task" : "created-task",
      taskId,
      path: join("data", "tasks", state, `${taskId}.md`),
    });
  }
  if (actions.length === 0) actions.push({ kind: "noop", reason: "task is current" });
  return actions;
}

export function dropGeneratedWorkTask(
  projectDir: string,
  existing: GeneratedWorkTaskRecord | null,
): GeneratedWorkProposalAction[] {
  if (!existing || existing.task.state === "done" || existing.task.state === "dropped") {
    return [];
  }
  moveTaskById(projectDir, existing.task.id, "dropped");
  return [{
    kind: "dropped-task",
    taskId: existing.task.id,
    fromState: existing.task.state,
  }];
}
