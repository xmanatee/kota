/** Check if an error is an auth error and return a user-friendly message, or null. */
export function formatAuthError(err: Error): string | null {
  const msg = err.message || "";
  if (
    msg.includes("Could not resolve authentication") ||
    msg.includes("apiKey") ||
    msg.includes("authToken") ||
    (err as { status?: number }).status === 401
  ) {
    return [
      "Error: Anthropic API authentication failed.\n",
      "Check that your ANTHROPIC_API_KEY is set and valid:",
      "  export ANTHROPIC_API_KEY=sk-ant-...\n",
      "Get a key at https://console.anthropic.com/settings/keys",
    ].join("\n");
  }
  return null;
}
