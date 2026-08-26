export type RepoTaskIntent = {
  problem: string;
  desiredOutcome: string;
  constraints: string | readonly string[];
  doneWhen: string | readonly string[];
  context?: string | readonly string[];
  acceptanceEvidence?: string | readonly string[];
};

function content(value: string | readonly string[]): string {
  return typeof value === "string"
    ? value.trim()
    : value.map((item) => `- ${item.trim()}`).join("\n");
}

function section(heading: string, value: string | readonly string[]): string[] {
  return [`## ${heading}`, "", content(value), ""];
}

/** Render the shared task-intent shape without interpreting its prose. */
export function renderRepoTaskIntent(intent: RepoTaskIntent): string {
  return [
    "",
    ...section("Problem", intent.problem),
    ...section("Desired Outcome", intent.desiredOutcome),
    ...section("Constraints", intent.constraints),
    ...section("Done When", intent.doneWhen),
    ...(intent.context === undefined ? [] : section("Context", intent.context)),
    ...(intent.acceptanceEvidence === undefined
      ? []
      : section("Acceptance Evidence", intent.acceptanceEvidence)),
  ].join("\n");
}
