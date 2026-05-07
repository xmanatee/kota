import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  ROOT_CROSS_CUTTING_FIXTURES,
  ROOT_ENTRYPOINT_SOURCES,
} from "#core/root-layout.js";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  parseBlockedPrecondition,
  readOperatorCaptureInstructedMarker,
  readOwnerAskMarkers,
} from "./blocked-precondition.js";
import {
  getRepoTaskStateDir,
  REPO_TASK_STATES,
  REPO_TASKS_DIR,
  type RepoTaskState,
  TASK_ACCEPTANCE_EVIDENCE_PLACEHOLDER,
  TASK_INITIATIVE_PLACEHOLDER,
  TASK_SOURCE_INTENT_PLACEHOLDER,
} from "./repo-tasks-domain.js";

export type TaskQueueValidationSeverity = "error" | "warning";

export type TaskQueueValidationFinding = {
  code: string;
  severity: TaskQueueValidationSeverity;
  message: string;
  paths?: string[];
};

export type TaskQueueValidationResult = {
  findings: TaskQueueValidationFinding[];
  counts: Record<RepoTaskState, number>;
  errorCount: number;
  warningCount: number;
};

export type TaskQueueValidationOptions = {
  minReady?: number;
  recommendedMinReady?: number;
  recommendedMinBacklog?: number;
  maxDoing?: number;
  staleBlockedDays?: number;
};

export type TaskFileEntry = {
  state: RepoTaskState;
  fileName: string;
  path: string;
  taskId: string;
  raw: string;
};

const ACTIVE_STEERING_FILES = [
  "AGENTS.md",
  "docs/STANDARDS.md",
  "data/tasks/AGENTS.md",
  "src/modules/autonomy/workflows/AGENTS.md",
] as const;

const ACTIVE_TASK_STATES: RepoTaskState[] = ["ready", "backlog", "doing", "blocked"];

const SOURCE_ACCESS_FAILURE_INDICATORS = [
  /\binaccessible\b/i,
  /\bnot\s+fetched\b/i,
  /\bcannot\s+(?:access|review|read|fetch)\b/i,
  /\bcould\s+not\s+(?:access|review|read|fetch)\b/i,
  /\bauth[- ]?walled\b/i,
  /\b(?:returned?|got|received|status)\s+(?:HTTP\s+)?40[123]\b/i,
  /\bsource\s+unavailable\b/i,
  /\bpaywall(?:ed)?\b/i,
] as const;

const SOURCE_ACCESS_HONEST_HANDLING = [
  /\bblocker\b/i,
  /\bfollow[- ]?up\b/i,
  /\benabler\b/i,
  /\bnext\s+action\b/i,
  /\bno\s+longer\s+(?:needed|relevant|worth)\b/i,
  /\bcreated?\s+task\b/i,
  /\bblocked\s+(?:on|by|until)\b/i,
  /\bdeferred\b/i,
  /\bnot\s+applicable\b/i,
  /\bunrelated\b/i,
  /\bcaptured\s+into\b/i,
  /\bdropped\b/i,
];

const SPEC_SECTION_HEADINGS = [
  "Problem",
  "Desired Outcome",
  "Constraints",
  "Done When",
] as const;

const ACTIVE_REQUIRED_SECTIONS = [
  "## Source / Intent",
  "## Acceptance Evidence",
] as const;

const STRATEGIC_REQUIRED_SECTIONS = [
  "## Initiative",
] as const;

const FAN_OUT_CONSOLIDATION_TASK_PREFIX = "task-fan-out-consolidation-";
const DEFAULT_STALE_BLOCKED_DAYS = 14;
const BLOCKED_ACTION_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

const ACTIVE_QUALITY_SECTION_HEADINGS = [
  "Source / Intent",
  "Initiative",
  "Acceptance Evidence",
] as const;

function stripSpecSections(raw: string): string {
  let out = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
  for (const heading of [
    ...SPEC_SECTION_HEADINGS,
    ...ACTIVE_QUALITY_SECTION_HEADINGS,
  ]) {
    const pattern = new RegExp(`## ${heading}\\n[\\s\\S]*?(?=\\n## |\\s*$)`, "g");
    out = out.replace(pattern, "");
  }
  return out;
}

export function hasDishonestSourceAccessCompletion(entry: TaskFileEntry): boolean {
  if (entry.state !== "done") return false;
  const body = stripSpecSections(entry.raw);
  const hasFailureIndicator = SOURCE_ACCESS_FAILURE_INDICATORS.some((p) => p.test(body));
  if (!hasFailureIndicator) return false;
  const hasHonestHandling = SOURCE_ACCESS_HONEST_HANDLING.some((p) => p.test(body));
  return !hasHonestHandling;
}

const DISALLOWED_NPM_COMMAND = /\bnpm\s+(?:run|test|install|i|ci|exec|start|build|lint|typecheck)\b/;
const DISALLOWED_SMALL_DIFF_GUIDANCE = [
  /\bsmall(?:est)?\s+(?:change|diff|patch|scope)\b/i,
  /\bminimal\s+(?:change|diff|patch|scope)\b/i,
  /\bsurgical\s+(?:change|fix|patch|scope)\b/i,
  /\btouches more files than\b/i,
] as const;

function listTaskEntries(projectDir: string): TaskFileEntry[] {
  const entries: TaskFileEntry[] = [];
  for (const state of REPO_TASK_STATES) {
    const dir = getRepoTaskStateDir(projectDir, state);
    if (!existsSync(dir)) {
      continue;
    }
    for (const fileName of readdirSync(dir)) {
      if (!fileName.endsWith(".md") || fileName === "AGENTS.md") {
        continue;
      }
      const path = join(dir, fileName);
      entries.push({
        state,
        fileName,
        path,
        taskId: basename(fileName, ".md"),
        raw: readFileSync(path, "utf8"),
      });
    }
  }
  return entries;
}

function listFilesRecursive(dir: string, predicate: (path: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const paths: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...listFilesRecursive(path, predicate));
      continue;
    }
    if (entry.isFile() && predicate(path)) {
      paths.push(path);
    }
  }
  return paths;
}

function listActivePackageManagerGuidanceFiles(projectDir: string): string[] {
  const explicitFiles = ACTIVE_STEERING_FILES
    .map((path) => join(projectDir, path))
    .filter((path) => existsSync(path));

  const promptFiles = listFilesRecursive(
    join(projectDir, "src", "modules", "autonomy", "workflows"),
    (path) => basename(path) === "prompt.md",
  );

  const activeTaskFiles = ACTIVE_TASK_STATES.flatMap((state) => {
    const dir = getRepoTaskStateDir(projectDir, state);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((fileName) => fileName.endsWith(".md") && fileName !== "AGENTS.md")
      .map((fileName) => join(dir, fileName));
  });

  return [...explicitFiles, ...promptFiles, ...activeTaskFiles].sort();
}

function findNpmPackageManagerGuidance(projectDir: string): string[] {
  return listActivePackageManagerGuidanceFiles(projectDir)
    .filter((path) => DISALLOWED_NPM_COMMAND.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(projectDir.length + 1));
}

function findSmallDiffOptimizingGuidance(projectDir: string): string[] {
  return listActivePackageManagerGuidanceFiles(projectDir)
    .filter((path) => {
      const raw = readFileSync(path, "utf8");
      return DISALLOWED_SMALL_DIFF_GUIDANCE.some((pattern) => pattern.test(raw));
    })
    .map((path) => path.slice(projectDir.length + 1));
}

function readTaskArea(entry: TaskFileEntry): string | null {
  const { attrs } = parseFlatFrontMatter(entry.raw);
  const area = String(attrs.area ?? "").trim();
  return area.length > 0 ? area : null;
}

function readTaskPriority(entry: TaskFileEntry): string | null {
  const { attrs } = parseFlatFrontMatter(entry.raw);
  const priority = String(attrs.priority ?? "").trim();
  return priority.length > 0 ? priority : null;
}

function isStrategicPriority(priority: string | null): boolean {
  return priority === "p0" || priority === "p1" || priority === "p2";
}

function isOpenTaskState(state: RepoTaskState): boolean {
  return state === "ready" || state === "backlog" || state === "doing" || state === "blocked";
}

function extractSection(raw: string, heading: string): string | null {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Capture from the heading up to the next `## ` heading or end of input.
  // `(?![\s\S])` is the JS-compatible "end of input" assertion. Earlier
  // versions used `\s*$` here, but with the `m` flag `$` matches every
  // line end, which silently truncated multi-line evidence sections to
  // just the first non-blank line.
  const match = raw.match(
    new RegExp(`^## ${escapedHeading}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"),
  );
  if (!match) return null;
  const body = match[1].trim();
  return body.length > 0 ? body : null;
}

function hasSubstantiveSection(raw: string, heading: string): boolean {
  const section = extractSection(raw, heading);
  if (!section) return false;
  if (section.includes(TASK_SOURCE_INTENT_PLACEHOLDER) || section.includes(TASK_INITIATIVE_PLACEHOLDER)) {
    return false;
  }
  return section.replace(/[-*\s]/g, "").length >= 12;
}

function hasAcceptanceEvidence(raw: string): boolean {
  const section = extractSection(raw, "Acceptance Evidence");
  if (!section) return false;
  if (section.includes(TASK_ACCEPTANCE_EVIDENCE_PLACEHOLDER)) {
    return false;
  }
  return /(?:^|\n)\s*-\s+\S/.test(section) || /\b(?:transcript|screenshot|fixture|test|command|artifact|validation|demo|snapshot)\b/i.test(section);
}

function listDuplicateFanOutConsolidationRows(raw: string): string[] {
  const section = extractSection(raw, "Multi-client fan-out batch");
  if (!section) return [];
  const taskIds = [...section.matchAll(/^- (task-[^\s]+) \([^)]+\) — .+$/gm)]
    .map((match) => match[1] ?? "");
  const counts = new Map<string, number>();
  for (const taskId of taskIds) counts.set(taskId, (counts.get(taskId) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([taskId]) => taskId)
    .sort();
}

function blockedTaskAgeDays(updatedAt: unknown, nowMs: number): number | null {
  const ms = Date.parse(String(updatedAt ?? ""));
  if (Number.isNaN(ms)) return null;
  return Math.floor((nowMs - ms) / (24 * 60 * 60 * 1000));
}

function hasFreshBlockedActionMarker(
  entry: TaskFileEntry,
  parsed: ReturnType<typeof parseBlockedPrecondition>,
  nowMs: number,
): boolean {
  if (!parsed.ok) return false;
  const precondition = parsed.precondition;
  if (precondition.kind === "owner-decision") {
    return readOwnerAskMarkers(entry.raw).some((marker) => {
      if (marker.slot !== precondition.slot) return false;
      const ms = Date.parse(marker.lastAskedAt);
      return !Number.isNaN(ms) && nowMs - ms < BLOCKED_ACTION_COOLDOWN_MS;
    });
  }
  if (precondition.kind === "operator-capture") {
    const marker = readOperatorCaptureInstructedMarker(entry.raw);
    if (!marker) return false;
    const ms = Date.parse(marker.lastInstructedAt);
    return !Number.isNaN(ms) && nowMs - ms < BLOCKED_ACTION_COOLDOWN_MS;
  }
  return false;
}

/**
 * Areas that classify a task as user-facing client/channel work, where
 * `## Acceptance Evidence` must name a rendered/runtime artifact when the
 * task declares one in its outcome. Other areas (autonomy, architecture,
 * core, ...) skip this gate even if they reference screenshots/transcripts
 * as part of meta-discussion (e.g. validators that *enforce* evidence).
 */
const CLIENT_CHANNEL_AREAS: ReadonlySet<string> = new Set(["client", "channel"]);

const RENDERED_EVIDENCE_DECLARATION_KEYWORDS = [
  /\bscreenshots?\b/i,
  /\bscreencasts?\b/i,
  /\brendered (?:artifact|evidence|fixture|view|snapshot|output|screenshot)s?\b/i,
  /\btranscripts?\b/i,
  /\bruntime probes?\b/i,
  /\bvisual evidence\b/i,
] as const;

const ACCEPTED_RENDERED_EVIDENCE_KEYWORDS = [
  /\bscreenshots?\b/i,
  /\bscreencasts?\b/i,
  /\brendered (?:artifact|evidence|fixture|view|snapshot|output)s?\b/i,
  /\btranscripts?\b/i,
  /\bruntime probes?\b/i,
  /\bsnapshot tests?\b/i,
  /\b(?:rendered|output)\s+fixtures?\b/i,
  /\boperator[- ]capture(?:d)?\b/i,
] as const;

function getDeliverableSections(raw: string): string {
  return [
    extractSection(raw, "Desired Outcome") ?? "",
    extractSection(raw, "Done When") ?? "",
  ].join("\n");
}

export function declaresRenderedEvidence(raw: string): boolean {
  const text = getDeliverableSections(raw);
  return RENDERED_EVIDENCE_DECLARATION_KEYWORDS.some((re) => re.test(text));
}

export function hasNamedRenderedEvidence(raw: string): boolean {
  const section = extractSection(raw, "Acceptance Evidence");
  if (!section) return false;
  return ACCEPTED_RENDERED_EVIDENCE_KEYWORDS.some((re) => re.test(section));
}

export function listRootLevelBuiltInModuleFiles(projectDir: string): string[] {
  const dir = join(projectDir, "src", "modules");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".ts"))
    .filter((fileName) => !fileName.endsWith(".test.ts"))
    .filter((fileName) => fileName !== "index.ts")
    .map((fileName) => join("src", "modules", fileName))
    .sort();
}

const ROOT_CLI_ARCHITECTURE_EXCLUSIONS = new Set<string>([
]);

export function listRootLevelCliArchitectureDebt(projectDir: string): string[] {
  const cliPath = join(projectDir, "src", "cli.ts");
  if (!existsSync(cliPath)) return [];
  const raw = readFileSync(cliPath, "utf8");
  const matches = [...raw.matchAll(/from\s+"\.\/([a-z0-9-]+-cli)\.js"/gi)];
  return matches
    .map((match) => match[1] ?? "")
    .filter((name) => name.length > 0)
    .filter((name) => !ROOT_CLI_ARCHITECTURE_EXCLUSIONS.has(name))
    .map((name) => join("src", `${name}.ts`))
    .sort();
}

export function listRootKernelHelperDebt(projectDir: string): string[] {
  const dir = join(projectDir, "src");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".integration.test.ts"))
    .filter((f) => !ROOT_ENTRYPOINT_SOURCES.has(f))
    .filter((f) => !ROOT_CROSS_CUTTING_FIXTURES.has(f))
    .map((f) => join("src", f))
    .sort();
}

export function listVisibleArchitectureDebt(projectDir: string): string[] {
  return [
    ...listRootLevelBuiltInModuleFiles(projectDir),
    ...listRootLevelCliArchitectureDebt(projectDir),
    ...listRootKernelHelperDebt(projectDir),
  ];
}

export function hasStrategicReadyArchitectureTask(projectDir: string): boolean {
  return listTaskEntries(projectDir)
    .filter((entry) => entry.state === "ready")
    .some((entry) =>
      readTaskArea(entry) === "architecture" && isStrategicPriority(readTaskPriority(entry)),
    );
}

export function hasArchitectureReadyCoverageGap(projectDir: string): boolean {
  const remainingArchitectureDebt = listVisibleArchitectureDebt(projectDir);
  return remainingArchitectureDebt.length > 0 && !hasStrategicReadyArchitectureTask(projectDir);
}

export function hasStrategicReadyCoverageGap(projectDir: string): boolean {
  const entries = listTaskEntries(projectDir);
  const readyEntries = entries.filter((entry) => entry.state === "ready");
  if (readyEntries.length === 0) {
    return false;
  }
  const hasReadyStrategicTask = readyEntries.some((entry) =>
    isStrategicPriority(readTaskPriority(entry)),
  );
  if (hasReadyStrategicTask) {
    return false;
  }
  const actionableEntries = entries.filter((entry) =>
    entry.state === "ready" || entry.state === "backlog" || entry.state === "doing",
  );
  return !actionableEntries.some((entry) => isStrategicPriority(readTaskPriority(entry)));
}

function readTaskGitStatus(projectDir: string): {
  untracked: string[];
  deleted: string[];
} {
  try {
    const output = execFileSync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all", "--", REPO_TASKS_DIR],
      { cwd: projectDir, encoding: "utf8" },
    );
    const untracked: string[] = [];
    const deleted: string[] = [];
    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const status = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const path = rawPath.includes(" -> ") ? rawPath.split(" -> ")[1] : rawPath;
      if (!path.endsWith(".md") || path.endsWith("/AGENTS.md")) {
        continue;
      }
      if (status === "??") {
        untracked.push(path);
        continue;
      }
      if (status[1] === "D") {
        deleted.push(path);
      }
    }
    return { untracked, deleted };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      untracked: [`git-status-unavailable: ${message}`],
      deleted: [],
    };
  }
}

function formatFindingList(findings: TaskQueueValidationFinding[]): string {
  return findings
    .map((finding) => `- [${finding.code}] ${finding.message}`)
    .join("\n");
}

export function validateTaskQueue(
  projectDir: string,
  options: TaskQueueValidationOptions = {},
): TaskQueueValidationResult {
  const entries = listTaskEntries(projectDir);
  const counts = Object.fromEntries(
    REPO_TASK_STATES.map((state) => [state, 0]),
  ) as Record<RepoTaskState, number>;
  const findings: TaskQueueValidationFinding[] = [];
  const seenTaskStates = new Map<string, string[]>();

  for (const entry of entries) {
    counts[entry.state] += 1;
    const seenStates = seenTaskStates.get(entry.taskId) ?? [];
    seenStates.push(entry.state);
    seenTaskStates.set(entry.taskId, seenStates);

    const { attrs } = parseFlatFrontMatter(entry.raw);
    const actualId = String(attrs.id || "");
    if (actualId !== entry.taskId) {
      findings.push({
        code: "task-id-mismatch",
        severity: "error",
        message: `${entry.path} frontmatter id "${actualId}" does not match filename "${entry.taskId}". ` +
          `Fix: set id: ${entry.taskId} in frontmatter, or rename the file to ${actualId}.md`,
        paths: [entry.path],
      });
    }
    const actualStatus = String(attrs.status || "");
    if (actualStatus !== entry.state) {
      findings.push({
        code: "task-status-mismatch",
        severity: "error",
        message: `${entry.path} frontmatter status "${actualStatus}" does not match directory "${entry.state}". ` +
          `Fix: run \`kota task move ${entry.taskId} ${entry.state}\` — never edit status frontmatter manually`,
        paths: [entry.path],
      });
    }
    const REQUIRED_ATTRS = ["title", "priority", "area", "summary", "created_at", "updated_at"] as const;
    for (const attr of REQUIRED_ATTRS) {
      if (typeof attrs[attr] !== "string" || String(attrs[attr]).trim().length === 0) {
        findings.push({
          code: "task-missing-required-attr",
          severity: "error",
          message: `${entry.path} is missing required frontmatter field: ${attr}`,
          paths: [entry.path],
        });
      }
    }

    const priority = String(attrs.priority ?? "");
    if (priority.length > 0 && !["p0", "p1", "p2", "p3"].includes(priority)) {
      findings.push({
        code: "task-invalid-priority",
        severity: "error",
        message: `${entry.path} has invalid priority "${priority}"; must be one of p0, p1, p2, p3`,
        paths: [entry.path],
      });
    }

    const REQUIRED_SECTIONS = ["## Problem", "## Desired Outcome", "## Constraints", "## Done When"] as const;
    for (const section of REQUIRED_SECTIONS) {
      if (!entry.raw.includes(section)) {
        findings.push({
          code: "task-missing-required-section",
          severity: "error",
          message: `${entry.path} is missing required section: ${section}`,
          paths: [entry.path],
        });
      }
    }

    if (isOpenTaskState(entry.state)) {
      for (const section of ACTIVE_REQUIRED_SECTIONS) {
        if (!entry.raw.includes(section)) {
          findings.push({
            code: "open-task-missing-quality-section",
            severity: "error",
            message: `${entry.path} is open work but is missing required section: ${section}. ` +
              "Open tasks must preserve source intent and define acceptance evidence before builders pull them.",
            paths: [entry.path],
          });
        }
      }

      if (!hasSubstantiveSection(entry.raw, "Source / Intent")) {
        findings.push({
          code: "open-task-weak-source-intent",
          severity: "error",
          message: `${entry.path} needs a substantive ## Source / Intent section. ` +
            "Preserve the owner/request/research source and the urgency or product reason behind the work.",
          paths: [entry.path],
        });
      }

      if (!hasAcceptanceEvidence(entry.raw)) {
        findings.push({
          code: "open-task-missing-acceptance-evidence",
          severity: "error",
          message: `${entry.path} needs concrete ## Acceptance Evidence bullets or artifact references. ` +
            "The task must say how completion will be demonstrated, not only what code may change.",
          paths: [entry.path],
        });
      }

      if (entry.taskId.startsWith(FAN_OUT_CONSOLIDATION_TASK_PREFIX)) {
        const duplicateRows = listDuplicateFanOutConsolidationRows(entry.raw);
        if (duplicateRows.length > 0) {
          findings.push({
            code: "fan-out-consolidation-duplicate-task-rows",
            severity: "error",
            message: `${entry.path} lists the same closed task more than once in its fan-out batch: ` +
              `${duplicateRows.join(", ")}. The consolidator must assign one primary surface per closed task; ` +
              `refresh the generated batch metadata or drop the invalid consolidation task.`,
            paths: [entry.path],
          });
        }
      }

      const area = readTaskArea(entry);
      if (
        area !== null &&
        CLIENT_CHANNEL_AREAS.has(area) &&
        declaresRenderedEvidence(entry.raw) &&
        !hasNamedRenderedEvidence(entry.raw)
      ) {
        findings.push({
          code: "client-task-missing-rendered-evidence",
          severity: "error",
          message: `${entry.path} is an area=${area} task that declares rendered/runtime evidence in its ` +
            `Desired Outcome or Done When (screenshot, screencast, rendered artifact/fixture, transcript, ` +
            `runtime probe, or visual evidence) but its ## Acceptance Evidence section does not name any of those ` +
            `artifact kinds. User-facing client/channel work needs evidence an operator can inspect — not only ` +
            `test logs. Add a screenshot/transcript/fixture/runtime-probe bullet, or document an operator-capture ` +
            `precondition if the artifact must be captured manually. See data/tasks/AGENTS.md for accepted artifact ` +
            `kinds per surface.`,
          paths: [entry.path],
        });
      }

      const priority = readTaskPriority(entry);
      if (isStrategicPriority(priority)) {
        for (const section of STRATEGIC_REQUIRED_SECTIONS) {
          if (!entry.raw.includes(section)) {
            findings.push({
              code: "strategic-task-missing-initiative",
              severity: "error",
              message: `${entry.path} is ${priority} open work but is missing required section: ${section}. ` +
                "Strategic work must name the larger outcome so it does not become an isolated tiny task.",
              paths: [entry.path],
            });
          }
        }
        if (!hasSubstantiveSection(entry.raw, "Initiative")) {
          findings.push({
            code: "strategic-task-weak-initiative",
            severity: "error",
            message: `${entry.path} needs a substantive ## Initiative section that names the broader outcome/campaign.`,
            paths: [entry.path],
          });
        }
      }
    }

    if (entry.state === "blocked") {
      const parsed = parseBlockedPrecondition(entry.raw);
      if (!parsed.ok) {
        const message = parsed.error === "missing-section"
          ? `${entry.path} is in blocked/ but is missing the required ## Unblock Precondition section. ` +
            `Add a precondition (kind: task-done | capability-installed | owner-decision | operator-capture) ` +
            `so the autonomy loop can re-evaluate the block instead of waiting on human re-review.`
          : `${entry.path} has a malformed ## Unblock Precondition: ${parsed.error}`;
        findings.push({
          code: "blocked-task-precondition-invalid",
          severity: "error",
          message,
          paths: [entry.path],
        });
      } else {
        const nowMs = Date.now();
        const ageDays = blockedTaskAgeDays(attrs.updated_at, nowMs);
        const staleAfterDays = options.staleBlockedDays ?? DEFAULT_STALE_BLOCKED_DAYS;
        if (
          ageDays !== null &&
          ageDays >= staleAfterDays &&
          !hasFreshBlockedActionMarker(entry, parsed, nowMs)
        ) {
          findings.push({
            code: "blocked-task-stale",
            severity: "warning",
            message: `${entry.path} has been blocked for ${ageDays} days without a fresh owner ask or operator-capture instruction marker. ` +
              `Fix: satisfy the precondition, move/drop/rescope the task, or let blocked-promoter refresh the applicable action marker.`,
            paths: [entry.path],
          });
        }
      }
    }

    if (hasDishonestSourceAccessCompletion(entry)) {
      findings.push({
        code: "done-task-inaccessible-source",
        severity: "error",
        message: `${entry.path} is marked done but records inaccessible or unread sources without a blocker, follow-up, or explicit rationale. ` +
          `Fix: move the task to blocked, add a follow-up task, or document why the source is no longer needed`,
        paths: [entry.path],
      });
    }
  }

  for (const [taskId, states] of seenTaskStates) {
    if (states.length > 1) {
      findings.push({
        code: "task-duplicate-state",
        severity: "error",
        message: `${taskId} appears in multiple task states: ${states.join(", ")}`,
      });
    }
  }

  const maxDoing = options.maxDoing ?? 1;
  if (counts.doing > maxDoing) {
    findings.push({
      code: "too-many-doing",
      severity: "error",
      message: `data/tasks/doing contains ${counts.doing} tasks; maximum supported is ${maxDoing}`,
    });
  }

  if (options.minReady !== undefined && counts.ready < options.minReady) {
    findings.push({
      code: "ready-underflow",
      severity: "error",
      message: `data/tasks/ready contains ${counts.ready} tasks; expected at least ${options.minReady}`,
    });
  }

  if (
    options.recommendedMinReady !== undefined &&
    counts.ready < options.recommendedMinReady
  ) {
    findings.push({
      code: "ready-thin",
      severity: "warning",
      message: `data/tasks/ready contains ${counts.ready} tasks; recommended minimum is ${options.recommendedMinReady}`,
    });
  }

  if (
    options.recommendedMinBacklog !== undefined &&
    counts.backlog < options.recommendedMinBacklog
  ) {
    findings.push({
      code: "backlog-thin",
      severity: "warning",
      message: `data/tasks/backlog contains ${counts.backlog} tasks; recommended minimum is ${options.recommendedMinBacklog}`,
    });
  }

  const gitStatus = readTaskGitStatus(projectDir);
  const gitStatusUnavailable = gitStatus.untracked.find((value) =>
    value.startsWith("git-status-unavailable: "),
  );
  if (gitStatusUnavailable) {
    findings.push({
      code: "git-status-unavailable",
      severity: "error",
      message: gitStatusUnavailable.replace(/^git-status-unavailable:\s*/, ""),
    });
  } else {
    if (gitStatus.untracked.length > 0) {
      findings.push({
        code: "task-untracked",
        severity: "error",
        message: `Task files must be tracked before a run finishes: ${gitStatus.untracked.join(", ")}. ` +
          `Fix: run \`git add ${gitStatus.untracked.join(" ")}\``,
        paths: gitStatus.untracked,
      });
    }
    if (gitStatus.deleted.length > 0) {
      findings.push({
        code: "task-deleted-unstaged",
        severity: "error",
        message: `Task file deletions must be staged: ${gitStatus.deleted.join(", ")}. ` +
          `Fix: run \`git add ${gitStatus.deleted.join(" ")}\``,
        paths: gitStatus.deleted,
      });
    }
  }

  const npmGuidancePaths = findNpmPackageManagerGuidance(projectDir);
  if (npmGuidancePaths.length > 0) {
    findings.push({
      code: "active-guidance-uses-npm",
      severity: "error",
      message: `Active guidance and open tasks must use pnpm, not npm: ${npmGuidancePaths.join(", ")}. ` +
        `Fix: replace npm run/test/install/exec/build commands with their pnpm equivalents in those files`,
      paths: npmGuidancePaths,
    });
  }

  const smallDiffGuidancePaths = findSmallDiffOptimizingGuidance(projectDir);
  if (smallDiffGuidancePaths.length > 0) {
    findings.push({
      code: "active-guidance-optimizes-small-diffs",
      severity: "error",
      message: `Active guidance and open tasks must optimize for clean outcomes, not small diffs: ${smallDiffGuidancePaths.join(", ")}`,
      paths: smallDiffGuidancePaths,
    });
  }

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;

  return { findings, counts, errorCount, warningCount };
}

export function assertArchitectureReadyCoverage(projectDir: string): string {
  const remainingArchitectureDebt = listVisibleArchitectureDebt(projectDir);
  if (remainingArchitectureDebt.length === 0 || hasStrategicReadyArchitectureTask(projectDir)) {
    return "architecture-ready-coverage-ok";
  }
  throw new Error(
    "data/tasks/ready must keep at least one p1/p2 architecture task while visible module-first debt remains: " +
      remainingArchitectureDebt.join(", "),
  );
}

export function assertStrategicReadyCoverage(projectDir: string): string {
  if (!hasStrategicReadyCoverageGap(projectDir)) {
    return "strategic-ready-coverage-ok";
  }
  throw new Error(
    "data/tasks/ready must keep at least one p0/p1/p2 task. The actionable queue has drifted " +
      "to p3-only work, which is too weak for the front of the autonomous queue.",
  );
}

export function assertTaskQueueValid(
  projectDir: string,
  options: TaskQueueValidationOptions = {},
): TaskQueueValidationResult {
  const result = validateTaskQueue(projectDir, options);
  const errors = result.findings.filter((finding) => finding.severity === "error");
  if (errors.length > 0) {
    throw new Error(formatFindingList(errors));
  }
  return result;
}

export function assertTaskQueueRecommendations(
  projectDir: string,
  options: TaskQueueValidationOptions = {},
): TaskQueueValidationResult {
  const result = validateTaskQueue(projectDir, options);
  const warnings = result.findings.filter((finding) => finding.severity === "warning");
  if (warnings.length > 0) {
    throw new Error(formatFindingList(warnings));
  }
  return result;
}
