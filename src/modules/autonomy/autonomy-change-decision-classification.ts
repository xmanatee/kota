import {
  AUTONOMY_CHANGE_CLASSES,
  type AutonomyChangeClass,
  type MaterialAutonomyChangeReason,
  type MaterialAutonomyChangeRequirement,
} from "./autonomy-change-decision-types.js";
import { parseAddedLinesByFile } from "./staged-diff.js";

const SOURCE_EXT_RE = /\.[cm]?[jt]sx?$/;

export function detectMaterialAutonomyChangeRequirement(
  diff: string,
): MaterialAutonomyChangeRequirement {
  const reasons: MaterialAutonomyChangeReason[] = [];
  for (const fileDiff of parseAddedLinesByFile(diff)) {
    const file = normalizePath(fileDiff.file);
    const changeClasses = classifyMaterialAutonomyChange(
      file,
      [...fileDiff.addedLines, ...fileDiff.deletedLines].join("\n"),
    );
    if (changeClasses.length === 0) continue;
    reasons.push({ file, changeClasses });
  }
  const changedFiles = [...new Set(reasons.map((reason) => reason.file))].sort();
  return {
    required: changedFiles.length > 0,
    changedFiles,
    changeClasses: sortedChangeClasses(
      new Set(reasons.flatMap((reason) => reason.changeClasses)),
    ),
    reasons,
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function isTestFile(file: string): boolean {
  return (
    /(?:^|\/)__tests__\//.test(file) ||
    /\.(?:test|spec|test-cases)\.[cm]?[jt]sx?$/.test(file) ||
    /\.integration\.[cm]?[jt]s$/.test(file)
  );
}

function sortedChangeClasses(
  values: ReadonlySet<AutonomyChangeClass>,
): AutonomyChangeClass[] {
  return AUTONOMY_CHANGE_CLASSES.filter((changeClass) =>
    values.has(changeClass),
  );
}

function pushClass(
  classes: Set<AutonomyChangeClass>,
  changeClass: AutonomyChangeClass,
): void {
  classes.add(changeClass);
}

function classifyMaterialAutonomyChange(
  file: string,
  changedText: string,
): AutonomyChangeClass[] {
  if (isTestFile(file)) return [];
  const classes = new Set<AutonomyChangeClass>();
  const text = `${file}\n${changedText}`;

  if (/^src\/modules\/autonomy\/workflows\/.+\/prompt\.md$/.test(file)) {
    pushClass(classes, "prompt");
  }
  if (/^src\/modules\/autonomy\/workflows\/.+\/workflow\.ts$/.test(file)) {
    pushClass(classes, "workflow");
  }
  if (
    /^src\/modules\/autonomy\/workflows\//.test(file) &&
    /\b(?:repairLoop|repair-loop|repair-check|repair check|critic check|semantic gate|validation gate|builderRepairChecks)\b/i.test(text)
  ) {
    pushClass(classes, "repair-loop");
  }
  if (
    /^src\/modules\/autonomy\//.test(file) &&
    /\b(?:critic|reviewer|review-scrutiny|semantic-gate|evaluator|evaluation)\b/i.test(text)
  ) {
    pushClass(classes, "reviewer");
  }
  if (
    /^src\/modules\/autonomy\//.test(file) &&
    /\b(?:critic|critical_issues|pass_with_warnings|verdict|thin acceptance)\b/i.test(text)
  ) {
    pushClass(classes, "critic-gate");
  }
  if (
    /^src\/modules\/autonomy\//.test(file) &&
    /\b(?:improver|semantic gate|scope-improver)\b/i.test(text)
  ) {
    pushClass(classes, "improver-gate");
  }
  if (
    /^src\/(?:core\/agent-harness|core\/workflow\/steps\/step-executor-agent|modules\/[^/]*agent-harness|modules\/harness-parity)\//.test(
      file,
    )
  ) {
    pushClass(classes, "harness");
  }
  if (
    /^src\/(?:modules\/model-clients|modules\/.*agent-harness|core\/model)\//.test(file) &&
    SOURCE_EXT_RE.test(file)
  ) {
    pushClass(classes, "model-routing");
  }

  return sortedChangeClasses(classes);
}
