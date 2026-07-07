import { checkAutonomyChangeDecisionForRun } from "./autonomy-change-decision.js";

export function runAutonomyChangeDecisionCheck(args: {
  projectDir: string;
  runDirPath: string;
}): string {
  return checkAutonomyChangeDecisionForRun(args.projectDir, args.runDirPath);
}
