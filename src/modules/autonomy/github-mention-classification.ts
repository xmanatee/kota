export function isGitHubImplementationRequest(body: string): boolean {
  return [
    /\b(implement|code|patch|modify|refactor)\b/i,
    /\b(fix|add|update|remove|delete|create)\b.+\b(file|code|feature|bug|test|branch|commit|pr|pull request)\b/i,
    /\b(open|make|submit)\b.+\b(pr|pull request|branch|commit)\b/i,
    /\b(push|commit)\b.+\b(change|code|fix|patch)\b/i,
  ].some((pattern) => pattern.test(body));
}
