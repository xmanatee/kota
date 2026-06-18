import { mentionsOperatorEvidence } from "#modules/autonomy/product-evidence.js";
import {
  extractTaskSections,
  listFullRepoTasks,
  type RepoTaskClass,
  type RepoTaskFullRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";

export type ImproverTaskClassCount = {
  taskClass: RepoTaskClass;
  count: number;
};

export type ImproverMetaGovernanceRisk = {
  taskId: string;
  title: string;
  state: "ready" | "doing";
  priority: string;
  updatedAt: string;
  reason: string;
};

export type ImproverProductEvidenceRisk = {
  taskId: string;
  title: string;
  updatedAt: string;
  reason: string;
};

export type ImproverTaskGovernanceEvidence = {
  generatedAt: string;
  openByTaskClass: ImproverTaskClassCount[];
  actionableMetaWithoutProductSafetyLink: ImproverMetaGovernanceRisk[];
  productDoneWithoutOperatorEvidence: ImproverProductEvidenceRisk[];
};

const TASK_CLASS_ORDER = new Map<RepoTaskClass, number>([
  ["Safety", 0],
  ["Product", 1],
  ["Platform", 2],
  ["Meta", 3],
  ["Unclassified", 4],
]);

const OPEN_STATES = new Set(["backlog", "ready", "doing", "blocked"]);
const ACTIONABLE_STATES = new Set(["ready", "doing"]);
const MAX_RISK_ROWS = 20;

function sortTaskClassCounts(
  counts: Map<RepoTaskClass, number>,
): ImproverTaskClassCount[] {
  return [...counts.entries()]
    .map(([taskClass, count]) => ({ taskClass, count }))
    .sort(
      (a, b) =>
        (TASK_CLASS_ORDER.get(a.taskClass) ?? 9) -
          (TASK_CLASS_ORDER.get(b.taskClass) ?? 9) ||
        a.taskClass.localeCompare(b.taskClass),
    );
}

function hasProductSafetyLink(record: RepoTaskFullRecord): boolean {
  const section = extractTaskSections(record.body, ["Product / Safety Link"])[
    "Product / Safety Link"
  ];
  return typeof section === "string" && section.trim().length > 0;
}

function mentionsOperatorJourneyEvidence(record: RepoTaskFullRecord): boolean {
  return mentionsOperatorEvidence(
    [record.title, record.summary, record.body].join("\n"),
  );
}

function byUpdatedThenId(
  a: Pick<RepoTaskFullRecord, "id" | "updatedAt">,
  b: Pick<RepoTaskFullRecord, "id" | "updatedAt">,
): number {
  const updatedDelta = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  if (updatedDelta !== 0) return updatedDelta;
  return a.id.localeCompare(b.id);
}

export function collectImproverTaskGovernance(
  projectDir: string,
  now: Date = new Date(),
): ImproverTaskGovernanceEvidence {
  const records = listFullRepoTasks(projectDir);
  const openCounts = new Map<RepoTaskClass, number>();

  for (const record of records) {
    if (!OPEN_STATES.has(record.state)) continue;
    openCounts.set(record.taskClass, (openCounts.get(record.taskClass) ?? 0) + 1);
  }

  const metaRisks = records
    .filter(
      (record) =>
        record.taskClass === "Meta" &&
        ACTIONABLE_STATES.has(record.state) &&
        !hasProductSafetyLink(record),
    )
    .sort(byUpdatedThenId)
    .slice(0, MAX_RISK_ROWS)
    .map((record) => ({
      taskId: record.id,
      title: record.title,
      state: record.state as "ready" | "doing",
      priority: record.priority,
      updatedAt: record.updatedAt,
      reason:
        "Actionable task_class=Meta work lacks a Product / Safety Link naming the visible blocker it closes.",
    }));

  const productRisks = records
    .filter(
      (record) =>
        record.taskClass === "Product" &&
        record.state === "done" &&
        !mentionsOperatorJourneyEvidence(record),
    )
    .sort(byUpdatedThenId)
    .slice(0, MAX_RISK_ROWS)
    .map((record) => ({
      taskId: record.id,
      title: record.title,
      updatedAt: record.updatedAt,
      reason:
        "Done Product task mentions no transcript, screenshot, runtime probe, rendered fixture, trace, snapshot, demo, or equivalent operator-journey evidence.",
    }));

  return {
    generatedAt: now.toISOString(),
    openByTaskClass: sortTaskClassCounts(openCounts),
    actionableMetaWithoutProductSafetyLink: metaRisks,
    productDoneWithoutOperatorEvidence: productRisks,
  };
}
