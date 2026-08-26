export type RepoTaskIntent = {
  problem: string;
  desiredOutcome: string;
  constraints: string;
  howWeWillKnow: string;
  context?: string;
};

function section(heading: string, body: string): string[] {
  return [`## ${heading}`, "", body.trim(), ""];
}

/**
 * Render KOTA's recommended task-authoring shape. The headings help agents
 * write concise intent records; the queue validator deliberately does not
 * parse or require them.
 */
export function renderRepoTaskIntent(intent: RepoTaskIntent): string {
  return [
    "",
    ...section("Problem", intent.problem),
    ...section("Desired Outcome", intent.desiredOutcome),
    ...section("Constraints", intent.constraints),
    ...section("How We Will Know", intent.howWeWillKnow),
    ...(intent.context?.trim()
      ? section("Context", intent.context)
      : []),
  ].join("\n");
}
